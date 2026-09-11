use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::CookieError,
    state::{Config, DrawState, Jar, JarMode},
    utils::{fund_vault, vault_rent_floor},
};

#[derive(Accounts)]
#[instruction(jar_id: u64)]
pub struct CreateJar<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = creator,
        space = 8 + Jar::INIT_SPACE,
        seeds = [JAR_SEED, creator.key().as_ref(), &jar_id.to_le_bytes()],
        bump
    )]
    pub jar: Account<'info, Jar>,

    #[account(
        mut,
        seeds = [JAR_VAULT_SEED, jar.key().as_ref()],
        bump
    )]
    pub jar_vault: SystemAccount<'info>,

    #[account(
        mut,
        seeds = [REWARD_VAULT_SEED, jar.key().as_ref()],
        bump
    )]
    pub reward_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn handle_create_jar(
    ctx: Context<CreateJar>,
    jar_id: u64,
    name: String,
    mode: JarMode,
    start_ts: i64,
    end_ts: i64,
    min_deposit: u64,
    initial_reward: u64,
) -> Result<()> {
    require!(!ctx.accounts.config.paused, CookieError::Paused);
    require!(name.len() <= MAX_JAR_NAME_LEN, CookieError::NameTooLong);

    let now = Clock::get()?.unix_timestamp;
    require!(start_ts >= now - 60, CookieError::StartInPast);

    let duration = end_ts
        .checked_sub(start_ts)
        .ok_or(CookieError::MathOverflow)?;
    require!(
        (MIN_JAR_DURATION..=MAX_JAR_DURATION).contains(&duration),
        CookieError::BadJarDuration
    );

    let floor = vault_rent_floor()?;
    fund_vault(
        &ctx.accounts.system_program,
        &ctx.accounts.creator,
        &ctx.accounts.jar_vault,
        floor,
    )?;
    fund_vault(
        &ctx.accounts.system_program,
        &ctx.accounts.creator,
        &ctx.accounts.reward_vault,
        floor,
    )?;

    if initial_reward > 0 {
        fund_vault(
            &ctx.accounts.system_program,
            &ctx.accounts.creator,
            &ctx.accounts.reward_vault,
            initial_reward,
        )?;
    }

    let jar = &mut ctx.accounts.jar;
    jar.creator = ctx.accounts.creator.key();
    jar.jar_id = jar_id;
    jar.name = name;
    jar.mode = mode;
    jar.start_ts = start_ts;
    jar.end_ts = end_ts;
    jar.reward_total = initial_reward;
    jar.reward_distributed = 0;
    jar.reward_claimed = 0;
    jar.reward_rate = 0;
    jar.total_deposited = 0;
    jar.depositor_count = 0;
    jar.acc_reward_per_share = 0;
    jar.last_update_ts = start_ts;
    jar.entry_count = 0;
    jar.min_deposit = min_deposit;
    jar.draw_state = DrawState::NotStarted;
    jar.draw_target_slot = 0;
    jar.winner_index = 0;
    jar.winner = None;
    jar.prize_claimed = false;
    jar.bump = ctx.bumps.jar;
    jar.vault_bump = ctx.bumps.jar_vault;
    jar.reward_vault_bump = ctx.bumps.reward_vault;

    jar.recompute_rate(now)?;

    let config = &mut ctx.accounts.config;
    config.jar_count = config
        .jar_count
        .checked_add(1)
        .ok_or(CookieError::MathOverflow)?;

    Ok(())
}

/// Anyone may top up a jar's reward pool. This is how a third-party app
/// sponsors a giveaway for its own users without needing any permission.
#[derive(Accounts)]
pub struct FundJar<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,

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

    pub system_program: Program<'info, System>,
}

pub fn handle_fund_jar(ctx: Context<FundJar>, amount: u64) -> Result<()> {
    require!(amount > 0, CookieError::ZeroAmount);

    let now = Clock::get()?.unix_timestamp;
    require!(now < ctx.accounts.jar.end_ts, CookieError::JarEnded);

    fund_vault(
        &ctx.accounts.system_program,
        &ctx.accounts.funder,
        &ctx.accounts.reward_vault,
        amount,
    )?;

    let jar = &mut ctx.accounts.jar;
    // Settle at the old rate before the budget changes, so existing depositors
    // keep exactly what they had already earned.
    jar.update(now)?;
    jar.reward_total = jar
        .reward_total
        .checked_add(amount)
        .ok_or(CookieError::MathOverflow)?;
    jar.recompute_rate(now)?;

    Ok(())
}
