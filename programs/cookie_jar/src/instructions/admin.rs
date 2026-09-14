use anchor_lang::prelude::*;

use crate::{constants::*, error::CookieError, state::Config};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,

    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(ctx: Context<Initialize>, relayer: Pubkey) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.authority = ctx.accounts.payer.key();
    config.relayer = relayer;
    config.paused = false;
    config.jar_count = 0;
    config.envelope_count = 0;
    config.bump = ctx.bumps.config;
    Ok(())
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.authority == authority.key() @ CookieError::NotAuthority
    )]
    pub config: Account<'info, Config>,
}

pub fn handle_set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
    ctx.accounts.config.paused = paused;
    Ok(())
}

pub fn handle_set_relayer(ctx: Context<AdminOnly>, relayer: Pubkey) -> Result<()> {
    ctx.accounts.config.relayer = relayer;
    Ok(())
}

/// Moves operational control to a governance address such as a Squads PDA.
/// The current authority must explicitly approve this one-way handoff; after
/// it lands, future pause and relayer changes must be executed by the new
/// authority.
pub fn handle_transfer_authority(ctx: Context<AdminOnly>, new_authority: Pubkey) -> Result<()> {
    require!(
        new_authority != Pubkey::default(),
        CookieError::InvalidAuthority
    );
    ctx.accounts.config.authority = new_authority;
    Ok(())
}
