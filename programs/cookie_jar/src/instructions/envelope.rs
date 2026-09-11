use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::CookieError,
    state::{Config, Envelope, EnvelopeClaim, Jar, JarMode, Position, SplitMode},
    utils::{derive_seed, fund_vault, latest_slot_hash, vault_rent_floor, vault_transfer},
};

/// Works out what this claimer gets.
///
/// Equal splits the remainder evenly. Surprise draws a random share bounded at
/// twice the running average, with a floor reserved for everyone still to come,
/// so a late claimer can never find the envelope empty.
fn compute_share(env: &Envelope, slot_hash: &[u8; 32], claimer: &Pubkey) -> Result<u64> {
    let claims_left = env
        .claims_total
        .checked_sub(env.claims_done)
        .ok_or(CookieError::MathOverflow)? as u64;
    require!(claims_left > 0, CookieError::EnvelopeEmpty);

    if claims_left == 1 {
        return Ok(env.remaining);
    }

    match env.split {
        SplitMode::Equal => Ok(env.remaining / claims_left),
        SplitMode::Surprise => {
            let reserve = MIN_ENVELOPE_SHARE
                .checked_mul(claims_left - 1)
                .ok_or(CookieError::MathOverflow)?;
            let spendable = env.remaining.saturating_sub(reserve);
            let twice_average = env
                .remaining
                .checked_mul(2)
                .ok_or(CookieError::MathOverflow)?
                / claims_left;

            let ceiling = spendable.min(twice_average).max(MIN_ENVELOPE_SHARE);
            if ceiling <= MIN_ENVELOPE_SHARE {
                return Ok(MIN_ENVELOPE_SHARE.min(env.remaining));
            }

            let span = ceiling - MIN_ENVELOPE_SHARE;
            let roll = derive_seed(slot_hash, claimer, env.claims_done as u64) % span;
            Ok(MIN_ENVELOPE_SHARE + roll)
        }
    }
}

#[derive(Accounts)]
#[instruction(envelope_id: u64)]
pub struct CreateEnvelope<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = creator,
        space = 8 + Envelope::INIT_SPACE,
        seeds = [ENVELOPE_SEED, creator.key().as_ref(), &envelope_id.to_le_bytes()],
        bump
    )]
    pub envelope: Account<'info, Envelope>,

    #[account(
        mut,
        seeds = [ENVELOPE_VAULT_SEED, envelope.key().as_ref()],
        bump
    )]
    pub envelope_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_create_envelope(
    ctx: Context<CreateEnvelope>,
    envelope_id: u64,
    message: String,
    amount: u64,
    claims_total: u16,
    split: SplitMode,
    expiry_ts: i64,
) -> Result<()> {
    require!(!ctx.accounts.config.paused, CookieError::Paused);
    require!(amount > 0, CookieError::ZeroAmount);
    require!(
        message.len() <= MAX_ENVELOPE_MESSAGE_LEN,
        CookieError::MessageTooLong
    );
    require!(
        claims_total > 0 && claims_total <= MAX_ENVELOPE_CLAIMS,
        CookieError::BadClaimCount
    );

    // Every slot has to be able to pay at least the floor, or the last claimers
    // would open an empty envelope.
    let minimum = MIN_ENVELOPE_SHARE
        .checked_mul(claims_total as u64)
        .ok_or(CookieError::MathOverflow)?;
    require!(amount >= minimum, CookieError::EnvelopeTooSmall);

    let now = Clock::get()?.unix_timestamp;
    require!(expiry_ts > now, CookieError::BadExpiry);

    fund_vault(
        &ctx.accounts.system_program,
        &ctx.accounts.creator,
        &ctx.accounts.envelope_vault,
        vault_rent_floor()?,
    )?;
    fund_vault(
        &ctx.accounts.system_program,
        &ctx.accounts.creator,
        &ctx.accounts.envelope_vault,
        amount,
    )?;

    let env = &mut ctx.accounts.envelope;
    env.creator = ctx.accounts.creator.key();
    env.envelope_id = envelope_id;
    env.message = message;
    env.total_amount = amount;
    env.remaining = amount;
    env.claims_total = claims_total;
    env.claims_done = 0;
    env.split = split;
    env.expiry_ts = expiry_ts;
    env.swept = false;
    env.bump = ctx.bumps.envelope;
    env.vault_bump = ctx.bumps.envelope_vault;

    let config = &mut ctx.accounts.config;
    config.envelope_count = config
        .envelope_count
        .checked_add(1)
        .ok_or(CookieError::MathOverflow)?;

    Ok(())
}

#[derive(Accounts)]
pub struct Crack<'info> {
    /// Authorises the claim. Never charged for anything, so this may be a
    /// wallet holding exactly zero COOK.
    pub claimer: Signer<'info>,

    /// Funds the rent for the claim record. Usually the relayer, which reclaims
    /// it from the sponsor vault in the same transaction.
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [ENVELOPE_SEED, envelope.creator.as_ref(), &envelope.envelope_id.to_le_bytes()],
        bump = envelope.bump
    )]
    pub envelope: Account<'info, Envelope>,

    #[account(
        mut,
        seeds = [ENVELOPE_VAULT_SEED, envelope.key().as_ref()],
        bump = envelope.vault_bump
    )]
    pub envelope_vault: SystemAccount<'info>,

    /// Creating this account is what makes a second claim impossible.
    #[account(
        init,
        payer = payer,
        space = 8 + EnvelopeClaim::INIT_SPACE,
        seeds = [CLAIM_SEED, envelope.key().as_ref(), claimer.key().as_ref()],
        bump
    )]
    pub claim: Account<'info, EnvelopeClaim>,

    /// CHECK: address-checked against the SlotHashes sysvar.
    #[account(address = solana_sdk_ids::sysvar::slot_hashes::ID)]
    pub slot_hashes: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_crack(ctx: Context<Crack>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        now < ctx.accounts.envelope.expiry_ts,
        CookieError::EnvelopeExpired
    );

    let slot_hash = latest_slot_hash(&ctx.accounts.slot_hashes.to_account_info())
        .ok_or(CookieError::DrawExpired)?;
    let claimer = ctx.accounts.claimer.key();
    let share = compute_share(&ctx.accounts.envelope, &slot_hash, &claimer)?;
    let envelope_key = ctx.accounts.envelope.key();

    vault_transfer(
        &ctx.accounts.system_program,
        &ctx.accounts.envelope_vault,
        &ctx.accounts.claimer.to_account_info(),
        share,
        &[
            ENVELOPE_VAULT_SEED,
            envelope_key.as_ref(),
            &[ctx.accounts.envelope.vault_bump],
        ],
    )?;

    let env = &mut ctx.accounts.envelope;
    env.remaining = env
        .remaining
        .checked_sub(share)
        .ok_or(CookieError::MathOverflow)?;
    env.claims_done = env
        .claims_done
        .checked_add(1)
        .ok_or(CookieError::MathOverflow)?;

    let claim = &mut ctx.accounts.claim;
    claim.envelope = envelope_key;
    claim.claimer = claimer;
    claim.amount = share;
    claim.claimed_at = now;
    claim.into_jar = false;
    claim.bump = ctx.bumps.claim;

    Ok(())
}

/// The instruction the whole protocol is built around.
///
/// A plain giveaway moves COOK out of the protocol and TVL drops. This moves it
/// from one protocol vault straight into another, so claiming is an inflow. The
/// claimer ends up with a withdrawable position and a reason to leave it alone.
#[derive(Accounts)]
pub struct CrackIntoJar<'info> {
    /// Authorises the claim and ends up owning the position. Charged nothing,
    /// so a wallet with zero COOK can do this.
    pub claimer: Signer<'info>,

    /// Funds the rent for the claim record and the position.
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [ENVELOPE_SEED, envelope.creator.as_ref(), &envelope.envelope_id.to_le_bytes()],
        bump = envelope.bump
    )]
    pub envelope: Account<'info, Envelope>,

    #[account(
        mut,
        seeds = [ENVELOPE_VAULT_SEED, envelope.key().as_ref()],
        bump = envelope.vault_bump
    )]
    pub envelope_vault: SystemAccount<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + EnvelopeClaim::INIT_SPACE,
        seeds = [CLAIM_SEED, envelope.key().as_ref(), claimer.key().as_ref()],
        bump
    )]
    pub claim: Account<'info, EnvelopeClaim>,

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
        seeds = [POSITION_SEED, jar.key().as_ref(), claimer.key().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,

    /// CHECK: address-checked against the SlotHashes sysvar.
    #[account(address = solana_sdk_ids::sysvar::slot_hashes::ID)]
    pub slot_hashes: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_crack_into_jar(ctx: Context<CrackIntoJar>) -> Result<()> {
    require!(!ctx.accounts.config.paused, CookieError::Paused);

    let now = Clock::get()?.unix_timestamp;
    require!(
        now < ctx.accounts.envelope.expiry_ts,
        CookieError::EnvelopeExpired
    );
    require!(now < ctx.accounts.jar.end_ts, CookieError::JarEnded);

    let slot_hash = latest_slot_hash(&ctx.accounts.slot_hashes.to_account_info())
        .ok_or(CookieError::DrawExpired)?;
    let claimer = ctx.accounts.claimer.key();
    let share = compute_share(&ctx.accounts.envelope, &slot_hash, &claimer)?;

    let envelope_key = ctx.accounts.envelope.key();
    let jar_key = ctx.accounts.jar.key();

    // Envelope vault to jar vault. The COOK never touches an external wallet.
    vault_transfer(
        &ctx.accounts.system_program,
        &ctx.accounts.envelope_vault,
        &ctx.accounts.jar_vault.to_account_info(),
        share,
        &[
            ENVELOPE_VAULT_SEED,
            envelope_key.as_ref(),
            &[ctx.accounts.envelope.vault_bump],
        ],
    )?;

    let env = &mut ctx.accounts.envelope;
    env.remaining = env
        .remaining
        .checked_sub(share)
        .ok_or(CookieError::MathOverflow)?;
    env.claims_done = env
        .claims_done
        .checked_add(1)
        .ok_or(CookieError::MathOverflow)?;

    let is_new = ctx.accounts.position.owner == Pubkey::default();
    if is_new {
        let position = &mut ctx.accounts.position;
        position.jar = jar_key;
        position.owner = claimer;
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

    let was_empty = ctx.accounts.position.amount == 0;

    let position = &mut ctx.accounts.position;
    position.amount = position
        .amount
        .checked_add(share)
        .ok_or(CookieError::MathOverflow)?;
    position.sync_debt(acc)?;
    let new_amount = position.amount;
    let already_entered = position.has_entry;

    let jar = &mut ctx.accounts.jar;
    jar.total_deposited = jar
        .total_deposited
        .checked_add(share)
        .ok_or(CookieError::MathOverflow)?;

    if was_empty {
        jar.depositor_count = jar
            .depositor_count
            .checked_add(1)
            .ok_or(CookieError::MathOverflow)?;
    }

    if jar.mode == JarMode::Lucky && !already_entered && new_amount >= jar.min_deposit {
        let position = &mut ctx.accounts.position;
        position.entry_index = jar.entry_count;
        position.has_entry = true;
        jar.entry_count = jar
            .entry_count
            .checked_add(1)
            .ok_or(CookieError::MathOverflow)?;
    }

    jar.recompute_rate(now)?;

    let claim = &mut ctx.accounts.claim;
    claim.envelope = envelope_key;
    claim.claimer = claimer;
    claim.amount = share;
    claim.claimed_at = now;
    claim.into_jar = true;
    claim.bump = ctx.bumps.claim;

    Ok(())
}

#[derive(Accounts)]
pub struct SweepEnvelope<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [ENVELOPE_SEED, envelope.creator.as_ref(), &envelope.envelope_id.to_le_bytes()],
        bump = envelope.bump,
        constraint = envelope.creator == creator.key() @ CookieError::NotAuthority
    )]
    pub envelope: Account<'info, Envelope>,

    #[account(
        mut,
        seeds = [ENVELOPE_VAULT_SEED, envelope.key().as_ref()],
        bump = envelope.vault_bump
    )]
    pub envelope_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_sweep_envelope(ctx: Context<SweepEnvelope>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= ctx.accounts.envelope.expiry_ts,
        CookieError::EnvelopeNotExpired
    );
    require!(!ctx.accounts.envelope.swept, CookieError::EnvelopeEmpty);

    let refund = ctx.accounts.envelope.remaining;
    require!(refund > 0, CookieError::EnvelopeEmpty);

    let envelope_key = ctx.accounts.envelope.key();
    vault_transfer(
        &ctx.accounts.system_program,
        &ctx.accounts.envelope_vault,
        &ctx.accounts.creator.to_account_info(),
        refund,
        &[
            ENVELOPE_VAULT_SEED,
            envelope_key.as_ref(),
            &[ctx.accounts.envelope.vault_bump],
        ],
    )?;

    let env = &mut ctx.accounts.envelope;
    env.remaining = 0;
    env.swept = true;

    Ok(())
}
