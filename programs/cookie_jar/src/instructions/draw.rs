use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::CookieError,
    state::{DrawState, Jar, JarMode, Position},
    utils::{derive_seed, slot_hash_for, vault_rent_floor, vault_transfer},
};

/// Anyone may run the draw. It is a permissionless crank, so a jar cannot be
/// held hostage by an absent creator.
#[derive(Accounts)]
pub struct RequestDraw<'info> {
    #[account(
        mut,
        seeds = [JAR_SEED, jar.creator.as_ref(), &jar.jar_id.to_le_bytes()],
        bump = jar.bump
    )]
    pub jar: Account<'info, Jar>,
}

pub fn handle_request_draw(ctx: Context<RequestDraw>) -> Result<()> {
    let jar = &mut ctx.accounts.jar;
    require!(jar.mode == JarMode::Lucky, CookieError::NotLuckyJar);

    let clock = Clock::get()?;
    require!(clock.unix_timestamp >= jar.end_ts, CookieError::JarNotEnded);
    require!(jar.entry_count > 0, CookieError::NoEntries);

    // A request that nobody finalized in time is stale and may be replaced.
    // Without this a draw could be stranded forever by a skipped slot.
    let stale = jar.draw_state == DrawState::Requested
        && clock.slot > jar.draw_target_slot.saturating_add(FINALIZE_WINDOW_SLOTS);
    require!(
        jar.draw_state == DrawState::NotStarted || stale,
        CookieError::DrawInProgress
    );

    // Commit to a slot that does not exist yet. Nobody, including whoever
    // called this, can know the seed at this point.
    jar.draw_target_slot = clock
        .slot
        .checked_add(DRAW_SLOT_DELAY)
        .ok_or(CookieError::MathOverflow)?;
    jar.draw_state = DrawState::Requested;

    Ok(())
}

#[derive(Accounts)]
pub struct FinalizeDraw<'info> {
    #[account(
        mut,
        seeds = [JAR_SEED, jar.creator.as_ref(), &jar.jar_id.to_le_bytes()],
        bump = jar.bump
    )]
    pub jar: Account<'info, Jar>,

    /// CHECK: address-checked against the SlotHashes sysvar, read raw because
    /// the full sysvar is too large to deserialize on-chain.
    #[account(address = solana_sdk_ids::sysvar::slot_hashes::ID)]
    pub slot_hashes: UncheckedAccount<'info>,
}

pub fn handle_finalize_draw(ctx: Context<FinalizeDraw>) -> Result<()> {
    let clock = Clock::get()?;
    let jar = &mut ctx.accounts.jar;

    require!(
        jar.draw_state == DrawState::Requested,
        CookieError::DrawNotRequested
    );
    require!(
        clock.slot >= jar.draw_target_slot,
        CookieError::DrawTooEarly
    );
    require!(
        clock.slot <= jar.draw_target_slot.saturating_add(FINALIZE_WINDOW_SLOTS),
        CookieError::DrawExpired
    );

    let slot_hash = slot_hash_for(
        &ctx.accounts.slot_hashes.to_account_info(),
        jar.draw_target_slot,
    )
    .ok_or(CookieError::DrawExpired)?;

    let jar_key = jar.key();
    let seed = derive_seed(&slot_hash, &jar_key, jar.entry_count);

    jar.winner_index = seed % jar.entry_count;
    jar.draw_state = DrawState::Finalized;

    msg!("winning entry: {}", jar.winner_index);
    Ok(())
}

#[derive(Accounts)]
pub struct ClaimPrize<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [JAR_SEED, jar.creator.as_ref(), &jar.jar_id.to_le_bytes()],
        bump = jar.bump
    )]
    pub jar: Account<'info, Jar>,

    #[account(
        mut,
        seeds = [REWARD_VAULT_SEED, jar.key().as_ref()],
        bump = jar.reward_vault_bump
    )]
    pub reward_vault: SystemAccount<'info>,

    #[account(
        seeds = [POSITION_SEED, jar.key().as_ref(), owner.key().as_ref()],
        bump = position.bump,
        constraint = position.owner == owner.key() @ CookieError::NotAuthority
    )]
    pub position: Account<'info, Position>,

    pub system_program: Program<'info, System>,
}

pub fn handle_claim_prize(ctx: Context<ClaimPrize>) -> Result<()> {
    let jar_key = ctx.accounts.jar.key();
    let position = &ctx.accounts.position;
    let jar = &ctx.accounts.jar;

    require!(
        jar.draw_state == DrawState::Finalized,
        CookieError::DrawNotFinalized
    );
    require!(!jar.prize_claimed, CookieError::PrizeAlreadyClaimed);
    require!(position.has_entry, CookieError::NotWinner);
    require!(
        position.entry_index == jar.winner_index,
        CookieError::NotWinner
    );
    // Depositing to win an entry and pulling the money straight back out does
    // not pay. Eligibility is checked again at the moment of claiming.
    require!(
        position.amount >= jar.min_deposit,
        CookieError::WinnerIneligible
    );

    let prize = ctx
        .accounts
        .reward_vault
        .lamports()
        .saturating_sub(vault_rent_floor()?);
    require!(prize > 0, CookieError::RewardVaultTooLow);

    vault_transfer(
        &ctx.accounts.system_program,
        &ctx.accounts.reward_vault,
        &ctx.accounts.owner.to_account_info(),
        prize,
        &[
            REWARD_VAULT_SEED,
            jar_key.as_ref(),
            &[ctx.accounts.jar.reward_vault_bump],
        ],
    )?;

    let jar = &mut ctx.accounts.jar;
    jar.prize_claimed = true;
    jar.winner = Some(ctx.accounts.owner.key());
    jar.reward_claimed = jar
        .reward_claimed
        .checked_add(prize)
        .ok_or(CookieError::MathOverflow)?;

    Ok(())
}

/// If the drawn entry never claims, the prize is not stranded. After the claim
/// window anyone can reset the draw so a new winner can be picked.
#[derive(Accounts)]
pub struct Redraw<'info> {
    #[account(
        mut,
        seeds = [JAR_SEED, jar.creator.as_ref(), &jar.jar_id.to_le_bytes()],
        bump = jar.bump
    )]
    pub jar: Account<'info, Jar>,
}

pub fn handle_redraw(ctx: Context<Redraw>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let jar = &mut ctx.accounts.jar;

    require!(jar.mode == JarMode::Lucky, CookieError::NotLuckyJar);
    require!(
        jar.draw_state == DrawState::Finalized,
        CookieError::DrawNotFinalized
    );
    require!(!jar.prize_claimed, CookieError::PrizeAlreadyClaimed);

    let reopen_at = jar
        .end_ts
        .checked_add(PRIZE_CLAIM_WINDOW)
        .ok_or(CookieError::MathOverflow)?;
    require!(now >= reopen_at, CookieError::ClaimWindowOpen);

    jar.draw_state = DrawState::NotStarted;
    jar.draw_target_slot = 0;
    jar.winner_index = 0;

    Ok(())
}
