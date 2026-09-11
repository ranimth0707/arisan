use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::CookieError,
    state::{Config, Jar, JarMode, Position},
    utils::{fund_vault, vault_rent_floor, vault_transfer},
};

#[derive(Accounts)]
pub struct Deposit<'info> {
    /// Owns the position and supplies the deposit itself.
    #[account(mut)]
    pub owner: Signer<'info>,

    /// Funds the rent for a first-time position. May be the relayer, so a user
    /// bridging in for the first time is not blocked by rent.
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [JAR_SEED, jar.creator.as_ref(), &jar.jar_id.to_le_bytes()],
        bump = jar.bump
    )]
    pub jar: Account<'info, Jar>,

    #[account(
        mut,
        seeds = [JAR_VAULT_SEED, jar.key().as_ref()],
        bump = jar.vault_bump
    )]
    pub jar_vault: SystemAccount<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, jar.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,

    pub system_program: Program<'info, System>,
}

pub fn handle_deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(!ctx.accounts.config.paused, CookieError::Paused);
    require!(amount > 0, CookieError::ZeroAmount);

    let now = Clock::get()?.unix_timestamp;
    require!(now < ctx.accounts.jar.end_ts, CookieError::JarEnded);

    let jar_key = ctx.accounts.jar.key();
    let is_new = ctx.accounts.position.owner == Pubkey::default();

    if is_new {
        let position = &mut ctx.accounts.position;
        position.jar = jar_key;
        position.owner = ctx.accounts.owner.key();
        position.amount = 0;
        position.reward_debt = 0;
        position.pending = 0;
        position.rewards_claimed = 0;
        position.entry_index = 0;
        position.has_entry = false;
        position.first_deposit_ts = now;
        position.bump = ctx.bumps.position;
    }

    ctx.accounts.jar.update(now)?;
    let acc = ctx.accounts.jar.acc_reward_per_share;
    ctx.accounts.position.settle(acc)?;

    fund_vault(
        &ctx.accounts.system_program,
        &ctx.accounts.owner,
        &ctx.accounts.jar_vault,
        amount,
    )?;

    let was_empty = ctx.accounts.position.amount == 0;

    let position = &mut ctx.accounts.position;
    position.amount = position
        .amount
        .checked_add(amount)
        .ok_or(CookieError::MathOverflow)?;
    position.sync_debt(acc)?;
    let new_amount = position.amount;

    let jar = &mut ctx.accounts.jar;
    jar.total_deposited = jar
        .total_deposited
        .checked_add(amount)
        .ok_or(CookieError::MathOverflow)?;

    if was_empty {
        jar.depositor_count = jar
            .depositor_count
            .checked_add(1)
            .ok_or(CookieError::MathOverflow)?;
    }

    // One entry per wallet, handed out the first time it clears the minimum.
    // Size buys no extra odds, which is the whole point of Lucky mode.
    if jar.mode == JarMode::Lucky
        && !ctx.accounts.position.has_entry
        && new_amount >= jar.min_deposit
    {
        let position = &mut ctx.accounts.position;
        position.entry_index = jar.entry_count;
        position.has_entry = true;
        jar.entry_count = jar
            .entry_count
            .checked_add(1)
            .ok_or(CookieError::MathOverflow)?;
    }

    // Depositing changes the denominator, so the rate has to be restated over
    // whatever budget and time are left.
    jar.recompute_rate(now)?;

    Ok(())
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
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
        seeds = [JAR_VAULT_SEED, jar.key().as_ref()],
        bump = jar.vault_bump
    )]
    pub jar_vault: SystemAccount<'info>,

    #[account(
        mut,
        seeds = [POSITION_SEED, jar.key().as_ref(), owner.key().as_ref()],
        bump = position.bump,
        constraint = position.owner == owner.key() @ CookieError::NotAuthority
    )]
    pub position: Account<'info, Position>,

    pub system_program: Program<'info, System>,
}

/// Always available, in full, with no penalty. Pausing the protocol does not
/// gate this instruction.
pub fn handle_withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    require!(amount > 0, CookieError::ZeroAmount);
    require!(
        amount <= ctx.accounts.position.amount,
        CookieError::InsufficientPosition
    );

    let now = Clock::get()?.unix_timestamp;
    let jar_key = ctx.accounts.jar.key();

    ctx.accounts.jar.update(now)?;
    let acc = ctx.accounts.jar.acc_reward_per_share;
    ctx.accounts.position.settle(acc)?;

    let position = &mut ctx.accounts.position;
    position.amount = position
        .amount
        .checked_sub(amount)
        .ok_or(CookieError::MathOverflow)?;
    position.sync_debt(acc)?;
    let now_empty = position.amount == 0;

    vault_transfer(
        &ctx.accounts.system_program,
        &ctx.accounts.jar_vault,
        &ctx.accounts.owner.to_account_info(),
        amount,
        &[
            JAR_VAULT_SEED,
            jar_key.as_ref(),
            &[ctx.accounts.jar.vault_bump],
        ],
    )?;

    let jar = &mut ctx.accounts.jar;
    jar.total_deposited = jar
        .total_deposited
        .checked_sub(amount)
        .ok_or(CookieError::MathOverflow)?;

    if now_empty {
        jar.depositor_count = jar.depositor_count.saturating_sub(1);
    }

    jar.recompute_rate(now)?;
    Ok(())
}

#[derive(Accounts)]
pub struct Harvest<'info> {
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
        mut,
        seeds = [POSITION_SEED, jar.key().as_ref(), owner.key().as_ref()],
        bump = position.bump,
        constraint = position.owner == owner.key() @ CookieError::NotAuthority
    )]
    pub position: Account<'info, Position>,

    pub system_program: Program<'info, System>,
}

pub fn handle_harvest(ctx: Context<Harvest>) -> Result<()> {
    require!(
        ctx.accounts.jar.mode == JarMode::Proportional,
        CookieError::NotProportionalJar
    );

    let now = Clock::get()?.unix_timestamp;
    let jar_key = ctx.accounts.jar.key();

    ctx.accounts.jar.update(now)?;
    let acc = ctx.accounts.jar.acc_reward_per_share;
    ctx.accounts.position.settle(acc)?;

    let payout = ctx.accounts.position.pending;
    require!(payout > 0, CookieError::NothingToHarvest);

    let available = ctx
        .accounts
        .reward_vault
        .lamports()
        .saturating_sub(vault_rent_floor()?);
    require!(payout <= available, CookieError::RewardVaultTooLow);

    vault_transfer(
        &ctx.accounts.system_program,
        &ctx.accounts.reward_vault,
        &ctx.accounts.owner.to_account_info(),
        payout,
        &[
            REWARD_VAULT_SEED,
            jar_key.as_ref(),
            &[ctx.accounts.jar.reward_vault_bump],
        ],
    )?;

    let position = &mut ctx.accounts.position;
    position.pending = 0;
    position.rewards_claimed = position
        .rewards_claimed
        .checked_add(payout)
        .ok_or(CookieError::MathOverflow)?;

    let jar = &mut ctx.accounts.jar;
    jar.reward_claimed = jar
        .reward_claimed
        .checked_add(payout)
        .ok_or(CookieError::MathOverflow)?;

    Ok(())
}
