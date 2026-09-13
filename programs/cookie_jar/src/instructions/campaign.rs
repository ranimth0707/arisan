use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::CookieError,
    state::{Campaign, Config, Donation, Jar, JarMode, Position},
    utils::{fund_vault, vault_rent_floor, vault_transfer},
};

/// Opens a request for help.
///
/// Anyone can start one. There is no approval step and no platform cut, because
/// the person asking is usually the one who can least afford either.
#[derive(Accounts)]
#[instruction(campaign_id: u64)]
pub struct CreateCampaign<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    /// Funds the rent for the campaign account. May be the relayer, so somebody
    /// with an empty wallet can still ask for help.
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = payer,
        space = 8 + Campaign::INIT_SPACE,
        seeds = [CAMPAIGN_SEED, creator.key().as_ref(), &campaign_id.to_le_bytes()],
        bump
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        seeds = [CAMPAIGN_VAULT_SEED, campaign.key().as_ref()],
        bump
    )]
    pub campaign_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_create_campaign(
    ctx: Context<CreateCampaign>,
    campaign_id: u64,
    title: String,
    story: String,
    target: u64,
    deadline_ts: i64,
) -> Result<()> {
    require!(!ctx.accounts.config.paused, CookieError::Paused);
    require!(!title.is_empty(), CookieError::TitleRequired);
    require!(title.len() <= MAX_CAMPAIGN_TITLE_LEN, CookieError::TitleTooLong);
    require!(story.len() <= MAX_CAMPAIGN_STORY_LEN, CookieError::StoryTooLong);
    require!(target > 0, CookieError::ZeroAmount);

    let now = Clock::get()?.unix_timestamp;
    require!(deadline_ts > now, CookieError::BadExpiry);

    // The vault has to clear the rent floor before anything can be taken out of
    // it. Paid by whoever is covering this transaction, not the creator.
    fund_vault(
        &ctx.accounts.system_program,
        &ctx.accounts.payer,
        &ctx.accounts.campaign_vault,
        vault_rent_floor()?,
    )?;

    let campaign = &mut ctx.accounts.campaign;
    campaign.creator = ctx.accounts.creator.key();
    campaign.campaign_id = campaign_id;
    campaign.title = title;
    campaign.story = story;
    campaign.target = target;
    campaign.raised = 0;
    campaign.withdrawn = 0;
    campaign.donor_count = 0;
    campaign.donation_count = 0;
    campaign.deadline_ts = deadline_ts;
    campaign.closed = false;
    campaign.bump = ctx.bumps.campaign;
    campaign.vault_bump = ctx.bumps.campaign_vault;

    Ok(())
}

/// Gives to a campaign.
///
/// A `Donation` record is opened the first time a wallet gives, which is what
/// makes an honest donor count possible. Giving again updates the same record
/// rather than inflating the number.
#[derive(Accounts)]
pub struct Donate<'info> {
    #[account(mut)]
    pub donor: Signer<'info>,

    /// Funds the rent for a first-time donation record.
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [CAMPAIGN_SEED, campaign.creator.as_ref(), &campaign.campaign_id.to_le_bytes()],
        bump = campaign.bump
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        seeds = [CAMPAIGN_VAULT_SEED, campaign.key().as_ref()],
        bump = campaign.vault_bump
    )]
    pub campaign_vault: SystemAccount<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Donation::INIT_SPACE,
        seeds = [DONATION_SEED, campaign.key().as_ref(), donor.key().as_ref()],
        bump
    )]
    pub donation: Account<'info, Donation>,

    pub system_program: Program<'info, System>,
}

pub fn handle_donate(ctx: Context<Donate>, amount: u64) -> Result<()> {
    require!(!ctx.accounts.config.paused, CookieError::Paused);
    require!(amount > 0, CookieError::ZeroAmount);
    require!(!ctx.accounts.campaign.closed, CookieError::CampaignClosed);

    let now = Clock::get()?.unix_timestamp;
    require!(
        now < ctx.accounts.campaign.deadline_ts,
        CookieError::CampaignEnded
    );

    fund_vault(
        &ctx.accounts.system_program,
        &ctx.accounts.donor,
        &ctx.accounts.campaign_vault,
        amount,
    )?;

    let first_time = ctx.accounts.donation.donor == Pubkey::default();
    let campaign_key = ctx.accounts.campaign.key();

    let donation = &mut ctx.accounts.donation;
    if first_time {
        donation.campaign = campaign_key;
        donation.donor = ctx.accounts.donor.key();
        donation.total = 0;
        donation.times = 0;
        donation.first_ts = now;
        donation.bump = ctx.bumps.donation;
    }
    donation.total = donation
        .total
        .checked_add(amount)
        .ok_or(CookieError::MathOverflow)?;
    donation.times = donation.times.saturating_add(1);
    donation.last_ts = now;

    let campaign = &mut ctx.accounts.campaign;
    campaign.raised = campaign
        .raised
        .checked_add(amount)
        .ok_or(CookieError::MathOverflow)?;
    campaign.donation_count = campaign
        .donation_count
        .checked_add(1)
        .ok_or(CookieError::MathOverflow)?;
    if first_time {
        campaign.donor_count = campaign
            .donor_count
            .checked_add(1)
            .ok_or(CookieError::MathOverflow)?;
    }

    Ok(())
}

/// Moves raised funds into the creator's own jar rather than out to a wallet.
///
/// This is the default on purpose. Someone raising for a hospital bill does not
/// need the whole amount in their wallet the day it is raised, and money sitting
/// in a jar is withdrawable at any moment while still earning. It also means a
/// successful campaign does not drain the protocol the way a payout would.
#[derive(Accounts)]
pub struct WithdrawToJar<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    /// Funds the rent for a first-time position.
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [CAMPAIGN_SEED, campaign.creator.as_ref(), &campaign.campaign_id.to_le_bytes()],
        bump = campaign.bump,
        constraint = campaign.creator == creator.key() @ CookieError::NotAuthority
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        seeds = [CAMPAIGN_VAULT_SEED, campaign.key().as_ref()],
        bump = campaign.vault_bump
    )]
    pub campaign_vault: SystemAccount<'info>,

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
        seeds = [POSITION_SEED, jar.key().as_ref(), creator.key().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,

    pub system_program: Program<'info, System>,
}

pub fn handle_withdraw_to_jar(ctx: Context<WithdrawToJar>, amount: u64) -> Result<()> {
    require!(amount > 0, CookieError::ZeroAmount);

    let now = Clock::get()?.unix_timestamp;
    require!(now < ctx.accounts.jar.end_ts, CookieError::JarEnded);

    let available = ctx
        .accounts
        .campaign
        .raised
        .checked_sub(ctx.accounts.campaign.withdrawn)
        .ok_or(CookieError::MathOverflow)?;
    require!(amount <= available, CookieError::NothingRaised);

    let campaign_key = ctx.accounts.campaign.key();
    let jar_key = ctx.accounts.jar.key();
    let creator = ctx.accounts.creator.key();

    vault_transfer(
        &ctx.accounts.system_program,
        &ctx.accounts.campaign_vault,
        &ctx.accounts.jar_vault.to_account_info(),
        amount,
        &[
            CAMPAIGN_VAULT_SEED,
            campaign_key.as_ref(),
            &[ctx.accounts.campaign.vault_bump],
        ],
    )?;

    let is_new = ctx.accounts.position.owner == Pubkey::default();
    if is_new {
        let position = &mut ctx.accounts.position;
        position.jar = jar_key;
        position.owner = creator;
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
        .checked_add(amount)
        .ok_or(CookieError::MathOverflow)?;
    position.sync_debt(acc)?;
    let new_amount = position.amount;
    let already_entered = position.has_entry;

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

    let campaign = &mut ctx.accounts.campaign;
    campaign.withdrawn = campaign
        .withdrawn
        .checked_add(amount)
        .ok_or(CookieError::MathOverflow)?;

    Ok(())
}

/// The direct route, for when somebody genuinely needs the money in hand.
#[derive(Accounts)]
pub struct WithdrawRaised<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [CAMPAIGN_SEED, campaign.creator.as_ref(), &campaign.campaign_id.to_le_bytes()],
        bump = campaign.bump,
        constraint = campaign.creator == creator.key() @ CookieError::NotAuthority
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        seeds = [CAMPAIGN_VAULT_SEED, campaign.key().as_ref()],
        bump = campaign.vault_bump
    )]
    pub campaign_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_withdraw_raised(ctx: Context<WithdrawRaised>, amount: u64) -> Result<()> {
    require!(amount > 0, CookieError::ZeroAmount);

    let available = ctx
        .accounts
        .campaign
        .raised
        .checked_sub(ctx.accounts.campaign.withdrawn)
        .ok_or(CookieError::MathOverflow)?;
    require!(amount <= available, CookieError::NothingRaised);

    let campaign_key = ctx.accounts.campaign.key();
    vault_transfer(
        &ctx.accounts.system_program,
        &ctx.accounts.campaign_vault,
        &ctx.accounts.creator.to_account_info(),
        amount,
        &[
            CAMPAIGN_VAULT_SEED,
            campaign_key.as_ref(),
            &[ctx.accounts.campaign.vault_bump],
        ],
    )?;

    let campaign = &mut ctx.accounts.campaign;
    campaign.withdrawn = campaign
        .withdrawn
        .checked_add(amount)
        .ok_or(CookieError::MathOverflow)?;

    Ok(())
}

/// Stops a campaign taking donations. Anything already raised stays withdrawable
/// by the creator, so closing can never strand what people gave.
#[derive(Accounts)]
pub struct CloseCampaign<'info> {
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [CAMPAIGN_SEED, campaign.creator.as_ref(), &campaign.campaign_id.to_le_bytes()],
        bump = campaign.bump,
        constraint = campaign.creator == creator.key() @ CookieError::NotAuthority
    )]
    pub campaign: Account<'info, Campaign>,
}

pub fn handle_close_campaign(ctx: Context<CloseCampaign>) -> Result<()> {
    ctx.accounts.campaign.closed = true;
    Ok(())
}
