//! Cookie Jar
//!
//! A gasless giveaway protocol for Cookie Chain, built so that claiming a
//! giveaway raises protocol TVL instead of draining it.
//!
//! A Fortune Cookie is an escrow anyone can crack open. Cracking it into a
//! Cookie Jar moves the COOK from one program vault to another in a single
//! instruction, leaving the claimer with a withdrawable position that earns
//! from a sponsor-funded reward pool.
//!
//! Principal is never at risk. There is no lending, no trading, and no
//! mechanism by which a depositor can end up with less than they put in.

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;
pub mod utils;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("Dwd7DXUQHRJaj1suYz6fTcVW7JJqBFVztg1z77t6Ysg");

#[program]
pub mod cookie_jar {
    use super::*;

    // --- config ---

    pub fn initialize(ctx: Context<Initialize>, relayer: Pubkey) -> Result<()> {
        instructions::admin::handle_initialize(ctx, relayer)
    }

    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        instructions::admin::handle_set_paused(ctx, paused)
    }

    pub fn set_relayer(ctx: Context<AdminOnly>, relayer: Pubkey) -> Result<()> {
        instructions::admin::handle_set_relayer(ctx, relayer)
    }

    pub fn transfer_authority(ctx: Context<AdminOnly>, new_authority: Pubkey) -> Result<()> {
        instructions::admin::handle_transfer_authority(ctx, new_authority)
    }

    // --- gas sponsorship ---

    pub fn deposit_gas(ctx: Context<DepositGas>, amount: u64) -> Result<()> {
        instructions::sponsor::handle_deposit_gas(ctx, amount)
    }

    pub fn withdraw_gas(ctx: Context<WithdrawGas>, amount: u64) -> Result<()> {
        instructions::sponsor::handle_withdraw_gas(ctx, amount)
    }

    pub fn reimburse_relayer(ctx: Context<ReimburseRelayer>, amount: u64) -> Result<()> {
        instructions::sponsor::handle_reimburse_relayer(ctx, amount)
    }

    // --- jars ---

    #[allow(clippy::too_many_arguments)]
    pub fn create_jar(
        ctx: Context<CreateJar>,
        jar_id: u64,
        name: String,
        mode: JarMode,
        start_ts: i64,
        end_ts: i64,
        min_deposit: u64,
        initial_reward: u64,
    ) -> Result<()> {
        instructions::jar::handle_create_jar(
            ctx,
            jar_id,
            name,
            mode,
            start_ts,
            end_ts,
            min_deposit,
            initial_reward,
        )
    }

    pub fn fund_jar(ctx: Context<FundJar>, amount: u64) -> Result<()> {
        instructions::jar::handle_fund_jar(ctx, amount)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::position::handle_deposit(ctx, amount)
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        instructions::position::handle_withdraw(ctx, amount)
    }

    pub fn harvest(ctx: Context<Harvest>) -> Result<()> {
        instructions::position::handle_harvest(ctx)
    }

    // --- lucky draw ---

    pub fn request_draw(ctx: Context<RequestDraw>) -> Result<()> {
        instructions::draw::handle_request_draw(ctx)
    }

    pub fn finalize_draw(ctx: Context<FinalizeDraw>) -> Result<()> {
        instructions::draw::handle_finalize_draw(ctx)
    }

    pub fn claim_prize(ctx: Context<ClaimPrize>) -> Result<()> {
        instructions::draw::handle_claim_prize(ctx)
    }

    pub fn redraw(ctx: Context<Redraw>) -> Result<()> {
        instructions::draw::handle_redraw(ctx)
    }

    // --- arisan, rotating savings circles ---

    pub fn create_circle(
        ctx: Context<CreateCircle>,
        circle_id: u64,
        name: String,
        description: String,
        social_url: String,
        invite_code_hash: [u8; 32],
        contribution: u64,
        collateral: u64,
        max_members: u16,
        round_seconds: i64,
    ) -> Result<()> {
        instructions::arisan::handle_create_circle(
            ctx,
            circle_id,
            name,
            description,
            social_url,
            invite_code_hash,
            contribution,
            collateral,
            max_members,
            round_seconds,
        )
    }

    pub fn join_circle(ctx: Context<JoinCircle>, invite_code_hash: [u8; 32]) -> Result<()> {
        instructions::arisan::handle_join_circle(ctx, invite_code_hash)
    }

    pub fn configure_circle_room(
        ctx: Context<ConfigureCircleRoom>,
        description: String,
        social_url: String,
        invite_code_hash: [u8; 32],
    ) -> Result<()> {
        instructions::arisan::handle_configure_circle_room(
            ctx,
            description,
            social_url,
            invite_code_hash,
        )
    }

    pub fn leave_circle(ctx: Context<LeaveCircle>) -> Result<()> {
        instructions::arisan::handle_leave_circle(ctx)
    }

    pub fn start_circle(ctx: Context<StartCircle>) -> Result<()> {
        instructions::arisan::handle_start_circle(ctx)
    }

    pub fn initialize_circle_roster(ctx: Context<InitializeCircleRoster>) -> Result<()> {
        instructions::arisan::handle_initialize_circle_roster(ctx)
    }

    pub fn initialize_circle_safety<'info>(
        ctx: Context<'info, InitializeCircleSafety<'info>>,
    ) -> Result<()> {
        instructions::arisan::handle_initialize_circle_safety(ctx)
    }

    pub fn sync_circle_members<'info>(ctx: Context<'info, SyncCircleMembers<'info>>) -> Result<()> {
        instructions::arisan::handle_sync_circle_members(ctx)
    }

    pub fn contribute(ctx: Context<Contribute>) -> Result<()> {
        instructions::arisan::handle_contribute(ctx)
    }

    pub fn slash_absent(ctx: Context<SlashAbsent>) -> Result<()> {
        instructions::arisan::handle_slash_absent(ctx)
    }

    pub fn top_up_bond(ctx: Context<TopUpBond>, amount: u64) -> Result<()> {
        instructions::arisan::handle_top_up_bond(ctx, amount)
    }

    pub fn request_turn(ctx: Context<RequestTurn>) -> Result<()> {
        instructions::arisan::handle_request_turn(ctx)
    }

    pub fn finalize_turn(ctx: Context<FinalizeTurn>) -> Result<()> {
        instructions::arisan::handle_finalize_turn(ctx)
    }

    pub fn claim_turn(ctx: Context<ClaimTurn>) -> Result<()> {
        instructions::arisan::handle_claim_turn(ctx)
    }

    pub fn redraw_turn(ctx: Context<RedrawTurn>) -> Result<()> {
        instructions::arisan::handle_redraw_turn(ctx)
    }

    pub fn withdraw_bond(ctx: Context<WithdrawBond>) -> Result<()> {
        instructions::arisan::handle_withdraw_bond(ctx)
    }

    // --- fundraisers ---

    pub fn create_campaign(
        ctx: Context<CreateCampaign>,
        campaign_id: u64,
        title: String,
        story: String,
        target: u64,
        deadline_ts: i64,
    ) -> Result<()> {
        instructions::campaign::handle_create_campaign(
            ctx,
            campaign_id,
            title,
            story,
            target,
            deadline_ts,
        )
    }

    pub fn donate(ctx: Context<Donate>, amount: u64) -> Result<()> {
        instructions::campaign::handle_donate(ctx, amount)
    }

    pub fn withdraw_to_jar(ctx: Context<WithdrawToJar>, amount: u64) -> Result<()> {
        instructions::campaign::handle_withdraw_to_jar(ctx, amount)
    }

    pub fn withdraw_raised(ctx: Context<WithdrawRaised>, amount: u64) -> Result<()> {
        instructions::campaign::handle_withdraw_raised(ctx, amount)
    }

    pub fn close_campaign(ctx: Context<CloseCampaign>) -> Result<()> {
        instructions::campaign::handle_close_campaign(ctx)
    }

    // --- fortune cookies ---

    pub fn create_envelope(
        ctx: Context<CreateEnvelope>,
        envelope_id: u64,
        message: String,
        amount: u64,
        claims_total: u16,
        split: SplitMode,
        expiry_ts: i64,
    ) -> Result<()> {
        instructions::envelope::handle_create_envelope(
            ctx,
            envelope_id,
            message,
            amount,
            claims_total,
            split,
            expiry_ts,
        )
    }

    pub fn crack(ctx: Context<Crack>) -> Result<()> {
        instructions::envelope::handle_crack(ctx)
    }

    pub fn crack_into_jar(ctx: Context<CrackIntoJar>) -> Result<()> {
        instructions::envelope::handle_crack_into_jar(ctx)
    }

    pub fn sweep_envelope(ctx: Context<SweepEnvelope>) -> Result<()> {
        instructions::envelope::handle_sweep_envelope(ctx)
    }
}
