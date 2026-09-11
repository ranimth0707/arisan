use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::CookieError,
    state::{Config, Sponsor},
    utils::{fund_vault, vault_rent_floor, vault_transfer},
};

#[derive(Accounts)]
pub struct DepositGas<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + Sponsor::INIT_SPACE,
        seeds = [SPONSOR_SEED, authority.key().as_ref()],
        bump
    )]
    pub sponsor: Account<'info, Sponsor>,

    #[account(
        mut,
        seeds = [SPONSOR_VAULT_SEED, authority.key().as_ref()],
        bump
    )]
    pub sponsor_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_deposit_gas(ctx: Context<DepositGas>, amount: u64) -> Result<()> {
    require!(amount > 0, CookieError::ZeroAmount);

    let sponsor = &mut ctx.accounts.sponsor;
    let first_time = sponsor.authority == Pubkey::default();

    if first_time {
        sponsor.authority = ctx.accounts.authority.key();
        sponsor.total_deposited = 0;
        sponsor.total_spent = 0;
        sponsor.tx_sponsored = 0;
        sponsor.bump = ctx.bumps.sponsor;
        sponsor.vault_bump = ctx.bumps.sponsor_vault;

        // Seed the vault so it can never fall into the rent-paying band.
        fund_vault(
            &ctx.accounts.system_program,
            &ctx.accounts.authority,
            &ctx.accounts.sponsor_vault,
            vault_rent_floor()?,
        )?;
    }

    fund_vault(
        &ctx.accounts.system_program,
        &ctx.accounts.authority,
        &ctx.accounts.sponsor_vault,
        amount,
    )?;

    sponsor.total_deposited = sponsor
        .total_deposited
        .checked_add(amount)
        .ok_or(CookieError::MathOverflow)?;

    Ok(())
}

#[derive(Accounts)]
pub struct WithdrawGas<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [SPONSOR_SEED, authority.key().as_ref()],
        bump = sponsor.bump,
        constraint = sponsor.authority == authority.key() @ CookieError::NotAuthority
    )]
    pub sponsor: Account<'info, Sponsor>,

    #[account(
        mut,
        seeds = [SPONSOR_VAULT_SEED, authority.key().as_ref()],
        bump = sponsor.vault_bump
    )]
    pub sponsor_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_withdraw_gas(ctx: Context<WithdrawGas>, amount: u64) -> Result<()> {
    require!(amount > 0, CookieError::ZeroAmount);

    let available = ctx
        .accounts
        .sponsor_vault
        .lamports()
        .saturating_sub(vault_rent_floor()?);
    require!(amount <= available, CookieError::SponsorBalanceTooLow);

    let authority = ctx.accounts.authority.key();
    vault_transfer(
        &ctx.accounts.system_program,
        &ctx.accounts.sponsor_vault,
        &ctx.accounts.authority.to_account_info(),
        amount,
        &[
            SPONSOR_VAULT_SEED,
            authority.as_ref(),
            &[ctx.accounts.sponsor.vault_bump],
        ],
    )?;

    Ok(())
}

/// Pays the relayer back for the fee it just fronted.
///
/// This is the only way COOK leaves a sponsor vault other than the sponsor
/// withdrawing it, and the amount is capped, so a compromised relayer key can
/// only bleed a vault one fee at a time rather than empty it.
#[derive(Accounts)]
pub struct ReimburseRelayer<'info> {
    #[account(mut)]
    pub relayer: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.relayer == relayer.key() @ CookieError::NotRelayer
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [SPONSOR_SEED, sponsor.authority.as_ref()],
        bump = sponsor.bump
    )]
    pub sponsor: Account<'info, Sponsor>,

    #[account(
        mut,
        seeds = [SPONSOR_VAULT_SEED, sponsor.authority.as_ref()],
        bump = sponsor.vault_bump
    )]
    pub sponsor_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_reimburse_relayer(ctx: Context<ReimburseRelayer>, amount: u64) -> Result<()> {
    require!(amount > 0, CookieError::ZeroAmount);
    require!(
        amount <= MAX_FEE_REIMBURSEMENT,
        CookieError::ReimbursementTooLarge
    );

    let available = ctx
        .accounts
        .sponsor_vault
        .lamports()
        .saturating_sub(vault_rent_floor()?);
    require!(amount <= available, CookieError::SponsorBalanceTooLow);

    let sponsor_authority = ctx.accounts.sponsor.authority;
    vault_transfer(
        &ctx.accounts.system_program,
        &ctx.accounts.sponsor_vault,
        &ctx.accounts.relayer.to_account_info(),
        amount,
        &[
            SPONSOR_VAULT_SEED,
            sponsor_authority.as_ref(),
            &[ctx.accounts.sponsor.vault_bump],
        ],
    )?;

    let sponsor = &mut ctx.accounts.sponsor;
    sponsor.total_spent = sponsor
        .total_spent
        .checked_add(amount)
        .ok_or(CookieError::MathOverflow)?;
    sponsor.tx_sponsored = sponsor
        .tx_sponsored
        .checked_add(1)
        .ok_or(CookieError::MathOverflow)?;

    Ok(())
}
