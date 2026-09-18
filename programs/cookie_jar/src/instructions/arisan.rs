//! Arisan: a rotating savings circle.
//!
//! A group agrees on an amount and a period. Every round each member pays that
//! amount in, and one member who has not won yet takes the whole pot. When
//! everyone has had a turn the circle is done and everybody has put in and taken
//! out the same amount, having had access to a lump sum they could not have
//! saved alone.
//!
//! Offline this works because everyone knows each other. Online it collapses,
//! for two reasons this module is built around:
//!
//! 1. Somebody stops paying once they have already won. Note the "once they have
//!    already won": that is where the exposure lives. Before your turn, walking
//!    away costs you the turn you were waiting for, so the incentive holds
//!    itself together. After it, you are holding the group's money.
//!
//!    So the reserve is sized to that liability and to nothing else. Take the
//!    pot on round k of N and you still owe `(N - k) x contribution`, which is
//!    every remaining contribution if you go first and nothing at all if you go
//!    last. `handle_claim_turn` will not release a pot to a member who does not
//!    hold that much, which turns the reserve into the price of a place in the
//!    queue rather than a toll at the door. Join with an empty reserve and you
//!    may still save; you simply cannot be paid early. Top it up and you move up.
//!
//!    The half that stays with the group is a member who stops paying before
//!    their turn. That shrinks one round's pot, it is recorded publicly as a
//!    miss, and it sidelines them from collecting. Pretending otherwise would
//!    mean demanding the whole commitment up front, which is what the first
//!    version of this did — and a circle you must already be able to afford is
//!    neither savings nor credit.
//! 2. Whoever holds the money disappears with it. Here nobody holds it. The pot
//!    lives in a program account, the draw is random and permissionless, and the
//!    organiser has no key to it and cannot change the rules after people join.

use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::CookieError,
    state::{Circle, CircleRoom, CircleRoster, CircleSafety, CircleState, Config, Member},
    utils::{derive_seed, fund_vault, slot_hash_for, vault_rent_floor, vault_transfer},
};

fn remaining_turns(circle: &Circle) -> Result<u64> {
    Ok(u64::from(
        circle
            .member_count
            .checked_sub(circle.winners_so_far)
            .ok_or(CookieError::MathOverflow)?,
    ))
}

fn reserve_per_member(circle: &Circle) -> Result<u64> {
    circle
        .contribution
        .checked_mul(remaining_turns(circle)?)
        .ok_or(CookieError::MathOverflow.into())
}

fn reserve_total(circle: &Circle) -> Result<u64> {
    reserve_per_member(circle)?
        .checked_mul(u64::from(circle.member_count))
        .ok_or(CookieError::MathOverflow.into())
}

/// Once every member has settled the current round, that round's obligation
/// has already been funded by either a wallet payment or a collateral slash.
/// The reserve check for the draw therefore covers only the turns after the
/// current payout. This is what lets a fully collateral-funded default advance
/// instead of failing because the bond was just moved into the pot.
fn reserve_after_current_round(circle: &Circle) -> Result<u64> {
    let future_turns = remaining_turns(circle)?
        .checked_sub(1)
        .ok_or(CookieError::MathOverflow)?;
    circle
        .contribution
        .checked_mul(future_turns)
        .ok_or(CookieError::MathOverflow)?
        .checked_mul(u64::from(circle.member_count))
        .ok_or(CookieError::MathOverflow.into())
}

/// What the bond vault must hold for a turn to be payable: one winner's
/// liability after collecting, not every member's.
///
/// The aggregate checks used to demand `contribution × remaining × members`,
/// which is only correct when every seat is reserved to the hilt. Once a seat
/// can be held by a saver carrying nothing, that sum stops describing anything
/// real. Exactly one member collects per round, and the per-member test in
/// `handle_claim_turn` is what decides whether they are covered — so the vault
/// only has to be able to back that one.
fn winner_reserve_floor(circle: &Circle) -> Result<u64> {
    let turns_left_after_this = remaining_turns(circle)?.saturating_sub(1);
    circle
        .contribution
        .checked_mul(turns_left_after_this)
        .ok_or(CookieError::MathOverflow.into())
}

fn bond_balance(bond: &SystemAccount<'_>) -> Result<u64> {
    bond.lamports()
        .checked_sub(vault_rent_floor()?)
        .ok_or(CookieError::MathOverflow.into())
}

/// Opens a circle. Every parameter here is frozen the moment it is written.
///
/// That immutability is the whole basis for joining one: an organiser cannot
/// raise the contribution, change the collateral, or extend the rounds after
/// members have committed money to it.
#[derive(Accounts)]
#[instruction(circle_id: u64)]
pub struct CreateCircle<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    /// Funds the rent. May be the relayer, so an empty wallet can still organise.
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = payer,
        space = 8 + Circle::INIT_SPACE,
        seeds = [CIRCLE_SEED, creator.key().as_ref(), &circle_id.to_le_bytes()],
        bump
    )]
    pub circle: Account<'info, Circle>,

    #[account(
        init,
        payer = payer,
        space = 8 + CircleRoom::INIT_SPACE,
        seeds = [ROOM_SEED, circle.key().as_ref()],
        bump
    )]
    pub room: Account<'info, CircleRoom>,

    /// Holds contributions. This is the pot that gets paid out.
    #[account(mut, seeds = [POT_SEED, circle.key().as_ref()], bump)]
    pub pot: SystemAccount<'info>,

    /// Holds collateral. Separate from the pot on purpose: collateral belongs to
    /// the member until they default, and must never be payable as a prize.
    #[account(mut, seeds = [BOND_SEED, circle.key().as_ref()], bump)]
    pub bond: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn handle_create_circle(
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
    require!(!ctx.accounts.config.paused, CookieError::Paused);
    require!(!name.is_empty(), CookieError::TitleRequired);
    require!(name.len() <= MAX_CIRCLE_NAME_LEN, CookieError::TitleTooLong);
    require!(
        !description.trim().is_empty(),
        CookieError::RoomDescriptionRequired
    );
    require!(
        description.len() <= MAX_CIRCLE_DESCRIPTION_LEN,
        CookieError::StoryTooLong
    );
    require!(
        !social_url.trim().is_empty(),
        CookieError::SocialPostRequired
    );
    require!(
        social_url.len() <= MAX_CIRCLE_SOCIAL_URL_LEN,
        CookieError::TitleTooLong
    );
    require!(
        social_url.starts_with("https://") || social_url.starts_with("http://"),
        CookieError::InvalidSocialPost
    );
    require!(
        invite_code_hash != [0u8; 32],
        CookieError::InviteCodeRequired
    );
    require!(contribution > 0, CookieError::ZeroAmount);
    require!(
        (2..=MAX_CIRCLE_MEMBERS).contains(&max_members),
        CookieError::BadMemberCount
    );
    require!(
        (MIN_ROUND_SECONDS..=MAX_ROUND_SECONDS).contains(&round_seconds),
        CookieError::BadRoundLength
    );
    // `collateral` is the reserve a seat costs to enter, not the whole
    // commitment. Requiring the latter made the circle pointless: you had to
    // already own the pot to be allowed to receive it, which is neither saving
    // nor credit.
    //
    // What the group is actually exposed to is a member who stops paying AFTER
    // collecting, and that liability is `contribution × turns still to come` —
    // largest for whoever goes first, zero for whoever goes last. So the reserve
    // is priced per turn and enforced when a turn is claimed, not at the door.
    // Join with nothing and you may still save, you simply cannot be drawn until
    // late; post more and you move up the queue.
    require!(
        collateral <= contribution
            .checked_mul(u64::from(max_members))
            .ok_or(CookieError::MathOverflow)?,
        CookieError::CollateralAboveCommitment
    );
    let floor = vault_rent_floor()?;
    fund_vault(
        &ctx.accounts.system_program,
        &ctx.accounts.payer,
        &ctx.accounts.pot,
        floor,
    )?;
    fund_vault(
        &ctx.accounts.system_program,
        &ctx.accounts.payer,
        &ctx.accounts.bond,
        floor,
    )?;

    let c = &mut ctx.accounts.circle;
    c.creator = ctx.accounts.creator.key();
    c.circle_id = circle_id;
    c.name = name;
    c.contribution = contribution;
    c.collateral = collateral;
    c.max_members = max_members;
    c.round_seconds = round_seconds;
    c.state = CircleState::Forming;
    c.member_count = 0;
    c.round = 0;
    c.next_payout_ts = 0;
    c.paid_this_round = 0;
    c.pot_amount = 0;
    c.winners_so_far = 0;
    c.draw_target_slot = 0;
    c.winner_index = 0;
    c.winner_drawn = false;
    c.bump = ctx.bumps.circle;
    c.pot_bump = ctx.bumps.pot;
    c.bond_bump = ctx.bumps.bond;

    let room = &mut ctx.accounts.room;
    room.circle = ctx.accounts.circle.key();
    room.creator = ctx.accounts.creator.key();
    room.description = description;
    room.social_url = social_url;
    room.invite_code_hash = invite_code_hash;
    room.bump = ctx.bumps.room;
    Ok(())
}

/// Adds room metadata to a legacy circle created before invite rooms existed.
#[derive(Accounts)]
pub struct ConfigureCircleRoom<'info> {
    pub creator: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [CIRCLE_SEED, circle.creator.as_ref(), &circle.circle_id.to_le_bytes()],
        bump = circle.bump,
        constraint = circle.creator == creator.key() @ CookieError::NotAuthority
    )]
    pub circle: Account<'info, Circle>,

    #[account(
        init,
        payer = payer,
        space = 8 + CircleRoom::INIT_SPACE,
        seeds = [ROOM_SEED, circle.key().as_ref()],
        bump
    )]
    pub room: Account<'info, CircleRoom>,

    pub system_program: Program<'info, System>,
}

pub fn handle_configure_circle_room(
    ctx: Context<ConfigureCircleRoom>,
    description: String,
    social_url: String,
    invite_code_hash: [u8; 32],
) -> Result<()> {
    require!(
        !description.trim().is_empty(),
        CookieError::RoomDescriptionRequired
    );
    require!(
        description.len() <= MAX_CIRCLE_DESCRIPTION_LEN,
        CookieError::StoryTooLong
    );
    require!(
        !social_url.trim().is_empty(),
        CookieError::SocialPostRequired
    );
    require!(
        social_url.len() <= MAX_CIRCLE_SOCIAL_URL_LEN,
        CookieError::TitleTooLong
    );
    require!(
        social_url.starts_with("https://") || social_url.starts_with("http://"),
        CookieError::InvalidSocialPost
    );
    require!(
        invite_code_hash != [0u8; 32],
        CookieError::InviteCodeRequired
    );

    let room = &mut ctx.accounts.room;
    room.circle = ctx.accounts.circle.key();
    room.creator = ctx.accounts.creator.key();
    room.description = description;
    room.social_url = social_url;
    room.invite_code_hash = invite_code_hash;
    room.bump = ctx.bumps.room;
    Ok(())
}

#[derive(Accounts)]
pub struct JoinCircle<'info> {
    #[account(mut)]
    pub member: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [CIRCLE_SEED, circle.creator.as_ref(), &circle.circle_id.to_le_bytes()],
        bump = circle.bump
    )]
    pub circle: Account<'info, Circle>,

    #[account(mut, seeds = [BOND_SEED, circle.key().as_ref()], bump = circle.bond_bump)]
    pub bond: SystemAccount<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + Member::INIT_SPACE,
        seeds = [MEMBER_SEED, circle.key().as_ref(), member.key().as_ref()],
        bump
    )]
    pub membership: Account<'info, Member>,

    #[account(
        seeds = [ROOM_SEED, circle.key().as_ref()],
        bump = room.bump,
        constraint = room.circle == circle.key() @ CookieError::RoomRequired
    )]
    pub room: Account<'info, CircleRoom>,

    pub system_program: Program<'info, System>,
}

pub fn handle_join_circle(ctx: Context<JoinCircle>, invite_code_hash: [u8; 32]) -> Result<()> {
    require!(
        invite_code_hash == ctx.accounts.room.invite_code_hash,
        CookieError::InviteCodeMismatch
    );
    require!(
        ctx.accounts.circle.state == CircleState::Forming,
        CookieError::CircleAlreadyStarted
    );
    require!(
        ctx.accounts.circle.member_count < ctx.accounts.circle.max_members,
        CookieError::CircleFull
    );

    // Collateral comes from the member, never the sponsor. Gas can be a gift;
    // the stake that makes a promise credible cannot be.
    fund_vault(
        &ctx.accounts.system_program,
        &ctx.accounts.member,
        &ctx.accounts.bond,
        ctx.accounts.circle.collateral,
    )?;

    let circle_key = ctx.accounts.circle.key();
    let c = &mut ctx.accounts.circle;

    let m = &mut ctx.accounts.membership;
    m.circle = circle_key;
    m.wallet = ctx.accounts.member.key();
    m.seat = c.member_count;
    m.collateral = c.collateral;
    m.paid_round = 0;
    m.rounds_paid = 0;
    m.rounds_missed = 0;
    m.has_won = false;
    m.active = true;
    m.joined_ts = Clock::get()?.unix_timestamp;
    m.bump = ctx.bumps.membership;

    c.member_count = c
        .member_count
        .checked_add(1)
        .ok_or(CookieError::MathOverflow)?;
    Ok(())
}

/// Leaves before the circle starts, taking the collateral back.
///
/// Only possible while forming. Once it is running, walking away is exactly the
/// behaviour the collateral exists to price.
#[derive(Accounts)]
pub struct LeaveCircle<'info> {
    #[account(mut)]
    pub member: Signer<'info>,

    #[account(
        mut,
        seeds = [CIRCLE_SEED, circle.creator.as_ref(), &circle.circle_id.to_le_bytes()],
        bump = circle.bump
    )]
    pub circle: Account<'info, Circle>,

    #[account(mut, seeds = [BOND_SEED, circle.key().as_ref()], bump = circle.bond_bump)]
    pub bond: SystemAccount<'info>,

    #[account(
        mut,
        close = member,
        seeds = [MEMBER_SEED, circle.key().as_ref(), member.key().as_ref()],
        bump = membership.bump,
        constraint = membership.wallet == member.key() @ CookieError::NotAuthority
    )]
    pub membership: Account<'info, Member>,

    /// The member holding the highest seat, moved down into the seat being
    /// vacated. Omitted only when the leaver already holds that seat.
    ///
    /// Seats are handed out as `seat = member_count`, so decrementing the count
    /// on the way out without closing the gap would hand the next joiner a seat
    /// number somebody else already holds, and leave the vacated number owned by
    /// nobody. Both are fatal: draws address members by seat, so a duplicate
    /// means one of the two can never receive a pot while still paying into it,
    /// and an orphaned seat stalls the round until the claim window expires.
    #[account(
        mut,
        seeds = [MEMBER_SEED, circle.key().as_ref(), tail.wallet.as_ref()],
        bump = tail.bump,
        constraint = tail.circle == circle.key() @ CookieError::BadRosterMember
    )]
    pub tail: Option<Account<'info, Member>>,

    pub system_program: Program<'info, System>,
}

pub fn handle_leave_circle(ctx: Context<LeaveCircle>) -> Result<()> {
    require!(
        ctx.accounts.circle.state == CircleState::Forming,
        CookieError::CircleAlreadyStarted
    );

    let last_seat = ctx
        .accounts
        .circle
        .member_count
        .checked_sub(1)
        .ok_or(CookieError::MathOverflow)?;
    let leaving_seat = ctx.accounts.membership.seat;

    match ctx.accounts.tail.as_mut() {
        None => require!(leaving_seat == last_seat, CookieError::TailMemberRequired),
        Some(tail) => {
            require!(leaving_seat != last_seat, CookieError::TailMemberRequired);
            require!(tail.seat == last_seat, CookieError::BadRosterMember);
            require!(
                tail.wallet != ctx.accounts.membership.wallet,
                CookieError::BadRosterMember
            );
            tail.seat = leaving_seat;
        }
    }

    let circle_key = ctx.accounts.circle.key();
    let refund = ctx.accounts.membership.collateral;

    vault_transfer(
        &ctx.accounts.system_program,
        &ctx.accounts.bond,
        &ctx.accounts.member.to_account_info(),
        refund,
        &[
            BOND_SEED,
            circle_key.as_ref(),
            &[ctx.accounts.circle.bond_bump],
        ],
    )?;

    let c = &mut ctx.accounts.circle;
    c.member_count = last_seat;
    Ok(())
}

/// Starts the circle. Membership closes and the first round begins.
#[derive(Accounts)]
pub struct StartCircle<'info> {
    pub starter: Signer<'info>,

    /// Funds the compact winner roster. May be the fee-paying relayer.
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [CIRCLE_SEED, circle.creator.as_ref(), &circle.circle_id.to_le_bytes()],
        bump = circle.bump
    )]
    pub circle: Account<'info, Circle>,

    #[account(
        init,
        payer = payer,
        space = 8 + CircleRoster::INIT_SPACE,
        seeds = [ROSTER_SEED, circle.key().as_ref()],
        bump
    )]
    pub roster: Account<'info, CircleRoster>,

    #[account(
        init,
        payer = payer,
        space = 8 + CircleSafety::INIT_SPACE,
        seeds = [SAFETY_SEED, circle.key().as_ref()],
        bump
    )]
    pub safety: Account<'info, CircleSafety>,

    #[account(seeds = [BOND_SEED, circle.key().as_ref()], bump = circle.bond_bump)]
    pub bond: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_start_circle(ctx: Context<StartCircle>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let c = &mut ctx.accounts.circle;

    require!(
        c.state == CircleState::Forming,
        CookieError::CircleAlreadyStarted
    );
    require!(c.member_count >= 2, CookieError::CircleTooSmall);
    // The organiser can start a partially filled circle, as before. Once every
    // seat is occupied, any member can start it so a demo or an absent organiser
    // cannot leave a perfectly formed circle stuck in the lobby.
    require!(
        c.creator == ctx.accounts.starter.key() || c.member_count == c.max_members,
        CookieError::StartRequiresCreatorOrFull
    );
    require!(
        bond_balance(&ctx.accounts.bond)? >= winner_reserve_floor(c)?,
        CookieError::CircleNotProtected
    );

    let roster = &mut ctx.accounts.roster;
    roster.circle = c.key();
    roster.winner_mask = [0; 2];
    roster.synced_mask = CircleRoster::full_mask(c.member_count);
    roster.ready = true;
    roster.bump = ctx.bumps.roster;

    let safety = &mut ctx.accounts.safety;
    safety.circle = c.key();
    safety.required_reserve = winner_reserve_floor(c)?;
    safety.secured_mask = CircleRoster::full_mask(c.member_count);
    safety.protected = true;
    safety.bump = ctx.bumps.safety;

    c.state = CircleState::Running;
    c.round = 1;
    c.next_payout_ts = now
        .checked_add(c.round_seconds)
        .ok_or(CookieError::MathOverflow)?;
    Ok(())
}

/// Creates the winner roster for a circle that was already running before the
/// elimination rule was deployed. New circles get this account when they start.
#[derive(Accounts)]
pub struct InitializeCircleRoster<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [CIRCLE_SEED, circle.creator.as_ref(), &circle.circle_id.to_le_bytes()],
        bump = circle.bump
    )]
    pub circle: Account<'info, Circle>,

    #[account(
        init,
        payer = payer,
        space = 8 + CircleRoster::INIT_SPACE,
        seeds = [ROSTER_SEED, circle.key().as_ref()],
        bump
    )]
    pub roster: Account<'info, CircleRoster>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + CircleSafety::INIT_SPACE,
        seeds = [SAFETY_SEED, circle.key().as_ref()],
        bump
    )]
    pub safety: Account<'info, CircleSafety>,

    #[account(seeds = [BOND_SEED, circle.key().as_ref()], bump = circle.bond_bump)]
    pub bond: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_circle_roster(ctx: Context<InitializeCircleRoster>) -> Result<()> {
    let c = &ctx.accounts.circle;
    require!(
        c.state == CircleState::Running,
        CookieError::CircleNotRunning
    );

    let roster = &mut ctx.accounts.roster;
    roster.circle = c.key();
    roster.winner_mask = [0; 2];
    roster.ready = false;
    roster.synced_mask = [0; 2];
    roster.bump = ctx.bumps.roster;

    let safety = &mut ctx.accounts.safety;
    if safety.circle == Pubkey::default() {
        safety.circle = c.key();
        safety.required_reserve = reserve_total(c)?;
        safety.secured_mask = [0; 2];
        safety.protected = false;
        safety.bump = ctx.bumps.safety;
    } else {
        require!(safety.circle == c.key(), CookieError::RosterMismatch);
    }
    Ok(())
}

/// Adds the solvency guard to a legacy roster that was created by the previous
/// upgrade. The full member list is checked here because a ready roster cannot
/// be re-synced just to establish reserve coverage.
#[derive(Accounts)]
pub struct InitializeCircleSafety<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [CIRCLE_SEED, circle.creator.as_ref(), &circle.circle_id.to_le_bytes()],
        bump = circle.bump
    )]
    pub circle: Account<'info, Circle>,

    #[account(seeds = [BOND_SEED, circle.key().as_ref()], bump = circle.bond_bump)]
    pub bond: SystemAccount<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + CircleSafety::INIT_SPACE,
        seeds = [SAFETY_SEED, circle.key().as_ref()],
        bump
    )]
    pub safety: Account<'info, CircleSafety>,

    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_circle_safety<'info>(
    ctx: Context<'info, InitializeCircleSafety<'info>>,
) -> Result<()> {
    let c = &ctx.accounts.circle;
    require!(
        c.state == CircleState::Running,
        CookieError::CircleNotRunning
    );
    require!(
        !ctx.remaining_accounts.is_empty(),
        CookieError::BadRosterMember
    );

    let per_member = reserve_per_member(c)?;
    let mut seen = [false; MAX_CIRCLE_MEMBERS as usize];
    let mut winners = 0u16;
    let safety = &mut ctx.accounts.safety;
    safety.circle = c.key();
    safety.required_reserve = reserve_total(c)?;
    safety.secured_mask = [0; 2];
    safety.bump = ctx.bumps.safety;

    for account_info in ctx.remaining_accounts.iter() {
        let member = Account::<Member>::try_from(account_info)
            .map_err(|_| error!(CookieError::BadRosterMember))?;
        require!(member.circle == c.key(), CookieError::BadRosterMember);
        require!(member.seat < c.member_count, CookieError::BadRosterMember);
        let seat = usize::from(member.seat);
        require!(!seen[seat], CookieError::BadRosterMember);
        seen[seat] = true;
        if member.has_won {
            winners = winners.checked_add(1).ok_or(CookieError::MathOverflow)?;
        }
        if member.collateral >= per_member {
            safety.mark_secured(member.seat);
        }
    }

    require!(
        seen[..usize::from(c.member_count)]
            .iter()
            .all(|present| *present),
        CookieError::RosterMismatch
    );
    require!(winners == c.winners_so_far, CookieError::RosterMismatch);
    require!(
        safety.is_fully_secured(c.member_count)
            && bond_balance(&ctx.accounts.bond)? >= safety.required_reserve,
        CookieError::CircleNotProtected
    );
    safety.protected = true;
    Ok(())
}

/// Imports legacy Member.has_won flags in one or more batches. It is
/// permissionless, but every supplied account is still owner/discriminator and
/// circle checked by Anchor before it can influence the roster.
#[derive(Accounts)]
pub struct SyncCircleMembers<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [CIRCLE_SEED, circle.creator.as_ref(), &circle.circle_id.to_le_bytes()],
        bump = circle.bump
    )]
    pub circle: Account<'info, Circle>,

    #[account(
        mut,
        seeds = [ROSTER_SEED, circle.key().as_ref()],
        bump = roster.bump,
        constraint = roster.circle == circle.key() @ CookieError::RosterMismatch
    )]
    pub roster: Account<'info, CircleRoster>,

    #[account(
        mut,
        seeds = [SAFETY_SEED, circle.key().as_ref()],
        bump = safety.bump,
        constraint = safety.circle == circle.key() @ CookieError::RosterMismatch
    )]
    pub safety: Account<'info, CircleSafety>,

    #[account(seeds = [BOND_SEED, circle.key().as_ref()], bump = circle.bond_bump)]
    pub bond: SystemAccount<'info>,
}

pub fn handle_sync_circle_members<'info>(
    ctx: Context<'info, SyncCircleMembers<'info>>,
) -> Result<()> {
    let c = &ctx.accounts.circle;
    require!(
        c.state == CircleState::Running,
        CookieError::CircleNotRunning
    );
    // A ready roster may be refreshed exactly once while safety is still
    // unprotected. This recovers circles that got the prior winner roster
    // upgrade but never had their reserve guard initialized.
    let refreshing = ctx.accounts.roster.ready;
    require!(
        !refreshing || !ctx.accounts.safety.protected,
        CookieError::RosterNotReady
    );
    require!(
        !ctx.remaining_accounts.is_empty(),
        CookieError::BadRosterMember
    );

    let roster = &mut ctx.accounts.roster;
    let safety = &mut ctx.accounts.safety;
    let per_member = reserve_per_member(c)?;
    if refreshing {
        safety.secured_mask = [0; 2];
    }
    for account_info in ctx.remaining_accounts.iter() {
        let member = Account::<Member>::try_from(account_info)
            .map_err(|_| error!(CookieError::BadRosterMember))?;
        require!(member.circle == c.key(), CookieError::BadRosterMember);
        require!(member.seat < c.member_count, CookieError::BadRosterMember);
        roster.mark_synced(member.seat);
        if member.has_won {
            roster.mark_winner(member.seat);
        }
        if member.collateral >= per_member {
            safety.mark_secured(member.seat);
        }
    }

    if roster.is_fully_synced(c.member_count) {
        require!(
            roster.winner_count() == c.winners_so_far,
            CookieError::RosterMismatch
        );
        require!(
            safety.is_fully_secured(c.member_count),
            CookieError::CircleNotProtected
        );
        require!(
            bond_balance(&ctx.accounts.bond)? >= reserve_total(c)?,
            CookieError::CircleNotProtected
        );
        safety.protected = true;
        roster.ready = true;
    }
    Ok(())
}

/// Pays this round's contribution into the pot.
#[derive(Accounts)]
pub struct Contribute<'info> {
    #[account(mut)]
    pub member: Signer<'info>,

    #[account(
        mut,
        seeds = [CIRCLE_SEED, circle.creator.as_ref(), &circle.circle_id.to_le_bytes()],
        bump = circle.bump
    )]
    pub circle: Account<'info, Circle>,

    #[account(mut, seeds = [POT_SEED, circle.key().as_ref()], bump = circle.pot_bump)]
    pub pot: SystemAccount<'info>,

    #[account(
        mut,
        seeds = [MEMBER_SEED, circle.key().as_ref(), member.key().as_ref()],
        bump = membership.bump,
        constraint = membership.wallet == member.key() @ CookieError::NotAuthority
    )]
    pub membership: Account<'info, Member>,

    pub system_program: Program<'info, System>,
}

pub fn handle_contribute(ctx: Context<Contribute>) -> Result<()> {
    let c = &ctx.accounts.circle;
    require!(
        c.state == CircleState::Running,
        CookieError::CircleNotRunning
    );
    require!(
        ctx.accounts.membership.paid_round < c.round,
        CookieError::AlreadyPaidThisRound
    );

    let amount = c.contribution;
    fund_vault(
        &ctx.accounts.system_program,
        &ctx.accounts.member,
        &ctx.accounts.pot,
        amount,
    )?;

    let round = c.round;
    let m = &mut ctx.accounts.membership;
    m.paid_round = round;
    m.rounds_paid = m.rounds_paid.saturating_add(1);

    let c = &mut ctx.accounts.circle;
    c.pot_amount = c
        .pot_amount
        .checked_add(amount)
        .ok_or(CookieError::MathOverflow)?;
    c.paid_this_round = c
        .paid_this_round
        .checked_add(1)
        .ok_or(CookieError::MathOverflow)?;
    Ok(())
}

/// Takes a missed contribution out of that member's collateral and puts it in
/// the pot.
///
/// Anyone may call this once the round is over. The point is that a member who
/// skips a round does not make the round smaller for everybody else; they pay
/// it out of the reserve they posted when they joined. If their reserve no
/// longer covers their remaining obligations they stop being eligible to win
/// until they top it up, so disappearing after winning cannot make a later pot
/// smaller for everybody else.
#[derive(Accounts)]
pub struct SlashAbsent<'info> {
    #[account(
        mut,
        seeds = [CIRCLE_SEED, circle.creator.as_ref(), &circle.circle_id.to_le_bytes()],
        bump = circle.bump
    )]
    pub circle: Account<'info, Circle>,

    #[account(mut, seeds = [POT_SEED, circle.key().as_ref()], bump = circle.pot_bump)]
    pub pot: SystemAccount<'info>,

    #[account(mut, seeds = [BOND_SEED, circle.key().as_ref()], bump = circle.bond_bump)]
    pub bond: SystemAccount<'info>,

    #[account(
        mut,
        seeds = [MEMBER_SEED, circle.key().as_ref(), membership.wallet.as_ref()],
        bump = membership.bump
    )]
    pub membership: Account<'info, Member>,

    pub system_program: Program<'info, System>,
}

pub fn handle_slash_absent(ctx: Context<SlashAbsent>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let c = &ctx.accounts.circle;

    require!(
        c.state == CircleState::Running,
        CookieError::CircleNotRunning
    );
    require!(now >= c.next_payout_ts, CookieError::RoundNotOver);
    require!(
        ctx.accounts.membership.paid_round < c.round,
        CookieError::AlreadyPaidThisRound
    );

    let due = c.contribution;
    let available = ctx.accounts.membership.collateral;
    let taken = due.min(available);

    // A member who has not had a turn yet may hold no reserve at all — that is
    // the whole point of letting somebody join to save rather than to borrow.
    // Their absence is still recorded and still sidelines them from winning, but
    // there is nothing to take, and the round settles with a smaller pot.
    //
    // This is the one risk the group carries, and it is the survivable half. A
    // member who defaults BEFORE their turn has taken nothing; they forfeit the
    // turn they were waiting for. The dangerous half — walking away after
    // collecting the pot — is what the reserve is sized against, and that is
    // enforced at the moment a turn is claimed.

    let circle_key = c.key();
    vault_transfer(
        &ctx.accounts.system_program,
        &ctx.accounts.bond,
        &ctx.accounts.pot.to_account_info(),
        taken,
        &[
            BOND_SEED,
            circle_key.as_ref(),
            &[ctx.accounts.circle.bond_bump],
        ],
    )?;

    let round = ctx.accounts.circle.round;
    let contribution = ctx.accounts.circle.contribution;
    let future_obligation = contribution
        .checked_mul(u64::from(
            c.member_count
                .saturating_sub(c.winners_so_far.saturating_add(1)),
        ))
        .ok_or(CookieError::MathOverflow)?;

    let m = &mut ctx.accounts.membership;
    m.collateral = m.collateral.saturating_sub(taken);
    m.rounds_missed = m.rounds_missed.saturating_add(1);
    // Counts as settled for this round so the same absence cannot be charged
    // twice, but not as a payment, which is what `rounds_paid` tracks.
    m.paid_round = round;
    m.active = m.collateral >= future_obligation;

    let c = &mut ctx.accounts.circle;
    c.pot_amount = c
        .pot_amount
        .checked_add(taken)
        .ok_or(CookieError::MathOverflow)?;
    c.paid_this_round = c
        .paid_this_round
        .checked_add(1)
        .ok_or(CookieError::MathOverflow)?;
    Ok(())
}

/// Puts collateral back, which also makes a sidelined member eligible again.
#[derive(Accounts)]
pub struct TopUpBond<'info> {
    #[account(mut)]
    pub member: Signer<'info>,

    #[account(
        seeds = [CIRCLE_SEED, circle.creator.as_ref(), &circle.circle_id.to_le_bytes()],
        bump = circle.bump
    )]
    pub circle: Account<'info, Circle>,

    #[account(mut, seeds = [BOND_SEED, circle.key().as_ref()], bump = circle.bond_bump)]
    pub bond: SystemAccount<'info>,

    #[account(
        mut,
        seeds = [MEMBER_SEED, circle.key().as_ref(), member.key().as_ref()],
        bump = membership.bump,
        constraint = membership.wallet == member.key() @ CookieError::NotAuthority
    )]
    pub membership: Account<'info, Member>,

    pub system_program: Program<'info, System>,
}

pub fn handle_top_up_bond(ctx: Context<TopUpBond>, amount: u64) -> Result<()> {
    require!(amount > 0, CookieError::ZeroAmount);

    fund_vault(
        &ctx.accounts.system_program,
        &ctx.accounts.member,
        &ctx.accounts.bond,
        amount,
    )?;

    // Topping up is how a member buys their way forward in the queue: the
    // reserve they hold decides the earliest turn they may be drawn for, and
    // `winner_reserve_floor` is that price at the circle's current position.
    let required = winner_reserve_floor(&ctx.accounts.circle)?;
    let m = &mut ctx.accounts.membership;
    m.collateral = m
        .collateral
        .checked_add(amount)
        .ok_or(CookieError::MathOverflow)?;
    if m.collateral >= required {
        m.active = true;
    }
    Ok(())
}

/// Commits the round's draw to a slot that does not exist yet.
///
/// Anyone may call it once the round is over. The seed is the hash of a block
/// three slots ahead, so at the moment the draw is requested nobody, including
/// whoever requested it, can know who wins. That matters more here than in a
/// game: the organiser is a participant, and being able to time the draw would
/// let them arrange their own turn.
#[derive(Accounts)]
pub struct RequestTurn<'info> {
    #[account(
        mut,
        seeds = [CIRCLE_SEED, circle.creator.as_ref(), &circle.circle_id.to_le_bytes()],
        bump = circle.bump
    )]
    pub circle: Account<'info, Circle>,

    #[account(
        mut,
        seeds = [SAFETY_SEED, circle.key().as_ref()],
        bump = safety.bump,
        constraint = safety.circle == circle.key() @ CookieError::RosterMismatch
    )]
    pub safety: Account<'info, CircleSafety>,

    #[account(seeds = [BOND_SEED, circle.key().as_ref()], bump = circle.bond_bump)]
    pub bond: SystemAccount<'info>,
}

pub fn handle_request_turn(ctx: Context<RequestTurn>) -> Result<()> {
    let clock = Clock::get()?;
    let c = &mut ctx.accounts.circle;

    require!(
        c.state == CircleState::Running,
        CookieError::CircleNotRunning
    );
    require!(
        clock.unix_timestamp >= c.next_payout_ts,
        CookieError::RoundNotOver
    );
    require!(
        c.paid_this_round == c.member_count,
        CookieError::RoundNotSettled
    );
    require!(
        ctx.accounts.safety.protected,
        CookieError::CircleNotProtected
    );
    let next_reserve = winner_reserve_floor(c)?;
    require!(
        bond_balance(&ctx.accounts.bond)? >= next_reserve,
        CookieError::CircleNotProtected
    );
    require!(!c.winner_drawn, CookieError::TurnAlreadyDrawn);

    // A request that nobody finalised in time is stale and may be replaced,
    // otherwise a skipped slot would strand the round forever.
    let stale = c.draw_target_slot != 0
        && clock.slot > c.draw_target_slot.saturating_add(FINALIZE_WINDOW_SLOTS);
    require!(
        c.draw_target_slot == 0 || stale,
        CookieError::DrawInProgress
    );

    ctx.accounts.safety.required_reserve = next_reserve;

    c.draw_target_slot = clock
        .slot
        .checked_add(DRAW_SLOT_DELAY)
        .ok_or(CookieError::MathOverflow)?;
    Ok(())
}

#[derive(Accounts)]
pub struct FinalizeTurn<'info> {
    #[account(
        mut,
        seeds = [CIRCLE_SEED, circle.creator.as_ref(), &circle.circle_id.to_le_bytes()],
        bump = circle.bump
    )]
    pub circle: Account<'info, Circle>,

    #[account(
        seeds = [ROSTER_SEED, circle.key().as_ref()],
        bump = roster.bump,
        constraint = roster.circle == circle.key() @ CookieError::RosterMismatch
    )]
    pub roster: Account<'info, CircleRoster>,

    #[account(
        seeds = [SAFETY_SEED, circle.key().as_ref()],
        bump = safety.bump,
        constraint = safety.circle == circle.key() @ CookieError::RosterMismatch
    )]
    pub safety: Account<'info, CircleSafety>,

    #[account(seeds = [BOND_SEED, circle.key().as_ref()], bump = circle.bond_bump)]
    pub bond: SystemAccount<'info>,

    /// CHECK: address-checked against the SlotHashes sysvar.
    #[account(address = solana_sdk_ids::sysvar::slot_hashes::ID)]
    pub slot_hashes: UncheckedAccount<'info>,
}

pub fn handle_finalize_turn(ctx: Context<FinalizeTurn>) -> Result<()> {
    let clock = Clock::get()?;
    let c = &mut ctx.accounts.circle;

    require!(
        c.state == CircleState::Running,
        CookieError::CircleNotRunning
    );
    require!(c.draw_target_slot != 0, CookieError::DrawNotRequested);
    require!(!c.winner_drawn, CookieError::TurnAlreadyDrawn);
    require!(clock.slot >= c.draw_target_slot, CookieError::DrawTooEarly);
    require!(
        clock.slot <= c.draw_target_slot.saturating_add(FINALIZE_WINDOW_SLOTS),
        CookieError::DrawExpired
    );
    require!(ctx.accounts.roster.ready, CookieError::RosterNotReady);
    require!(
        ctx.accounts.safety.protected,
        CookieError::CircleNotProtected
    );
    require!(
        bond_balance(&ctx.accounts.bond)? >= ctx.accounts.safety.required_reserve,
        CookieError::CircleNotProtected
    );
    require!(
        ctx.accounts.roster.winner_count() == c.winners_so_far,
        CookieError::RosterMismatch
    );

    let hash = slot_hash_for(
        &ctx.accounts.slot_hashes.to_account_info(),
        c.draw_target_slot,
    )
    .ok_or(CookieError::DrawExpired)?;

    // Draw uniformly from only the seats that have not received a pot. The
    // final round therefore has exactly one possible result, while earlier
    // winners are mathematically absent rather than rejected after the draw.
    let key = c.key();
    let seed = derive_seed(&hash, &key, c.round as u64);
    let remaining = c
        .member_count
        .checked_sub(c.winners_so_far)
        .ok_or(CookieError::MathOverflow)?;
    require!(remaining > 0, CookieError::NoEligibleMembers);
    let rank = (seed % u64::from(remaining)) as u16;
    c.winner_index = ctx
        .accounts
        .roster
        .select_unwon(c.member_count, rank)
        .ok_or(CookieError::NoEligibleMembers)?;
    c.winner_drawn = true;

    msg!("round {} drew seat {}", c.round, c.winner_index);
    Ok(())
}

/// The drawn member takes the pot, and the circle moves to the next round.
///
/// Eligibility is checked here rather than at draw time: the winner must hold
/// this seat, must not have won already, must be reserve-solvent, and must have
/// settled this round. Settlement may be a direct payment or a full collateral
/// slash; the latter keeps the pot whole without pretending the member paid.
#[derive(Accounts)]
pub struct ClaimTurn<'info> {
    #[account(mut)]
    pub winner: Signer<'info>,

    #[account(
        mut,
        seeds = [CIRCLE_SEED, circle.creator.as_ref(), &circle.circle_id.to_le_bytes()],
        bump = circle.bump
    )]
    pub circle: Account<'info, Circle>,

    #[account(
        mut,
        seeds = [ROSTER_SEED, circle.key().as_ref()],
        bump = roster.bump,
        constraint = roster.circle == circle.key() @ CookieError::RosterMismatch
    )]
    pub roster: Account<'info, CircleRoster>,

    #[account(
        mut,
        seeds = [SAFETY_SEED, circle.key().as_ref()],
        bump = safety.bump,
        constraint = safety.circle == circle.key() @ CookieError::RosterMismatch
    )]
    pub safety: Account<'info, CircleSafety>,

    #[account(mut, seeds = [POT_SEED, circle.key().as_ref()], bump = circle.pot_bump)]
    pub pot: SystemAccount<'info>,

    #[account(
        mut,
        seeds = [MEMBER_SEED, circle.key().as_ref(), winner.key().as_ref()],
        bump = membership.bump,
        constraint = membership.wallet == winner.key() @ CookieError::NotAuthority
    )]
    pub membership: Account<'info, Member>,

    pub system_program: Program<'info, System>,
}

pub fn handle_claim_turn(ctx: Context<ClaimTurn>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let c = &ctx.accounts.circle;
    let m = &ctx.accounts.membership;

    require!(
        c.state == CircleState::Running,
        CookieError::CircleNotRunning
    );
    require!(c.winner_drawn, CookieError::DrawNotFinalized);
    require!(ctx.accounts.roster.ready, CookieError::RosterNotReady);
    require!(
        ctx.accounts.roster.winner_count() == c.winners_so_far,
        CookieError::RosterMismatch
    );
    require!(m.seat == c.winner_index, CookieError::NotYourTurn);
    require!(!m.has_won, CookieError::AlreadyHadATurn);

    // The whole reserve rule, in one place: you may take the pot only if you
    // still hold what you would owe the group afterwards.
    //
    // Collect on the last turn and that is nothing, so a member who joined with
    // an empty reserve to save can always take the turn they waited for.
    // Collect first, and it is every remaining contribution, because the group
    // is handing you money against a promise that is worth exactly what backs
    // it. The reserve therefore prices a place in the queue rather than
    // gatekeeping the door.
    let turns_left_after_this = remaining_turns(c)?
        .checked_sub(1)
        .ok_or(CookieError::MathOverflow)?;
    let owed_after_winning = c
        .contribution
        .checked_mul(turns_left_after_this)
        .ok_or(CookieError::MathOverflow)?;
    require!(
        m.collateral >= owed_after_winning,
        CookieError::ReserveTooThinForTurn
    );
    require!(
        !ctx.accounts.roster.is_winner(m.seat),
        CookieError::AlreadyHadATurn
    );
    require!(m.active, CookieError::MemberSidelined);
    require!(m.paid_round >= c.round, CookieError::PayFirst);

    let amount = c.pot_amount;
    require!(amount > 0, CookieError::PotEmpty);

    let circle_key = c.key();
    vault_transfer(
        &ctx.accounts.system_program,
        &ctx.accounts.pot,
        &ctx.accounts.winner.to_account_info(),
        amount,
        &[POT_SEED, circle_key.as_ref(), &[c.pot_bump]],
    )?;

    let m = &mut ctx.accounts.membership;
    m.has_won = true;
    ctx.accounts.roster.mark_winner(m.seat);

    let c = &mut ctx.accounts.circle;
    c.pot_amount = 0;
    c.paid_this_round = 0;
    c.winner_drawn = false;
    c.draw_target_slot = 0;
    c.winners_so_far = c
        .winners_so_far
        .checked_add(1)
        .ok_or(CookieError::MathOverflow)?;

    if c.winners_so_far >= c.member_count {
        // Everyone has had a turn. The circle is complete and collateral can
        // come home.
        c.state = CircleState::Finished;
    } else {
        c.round = c.round.checked_add(1).ok_or(CookieError::MathOverflow)?;
        c.next_payout_ts = now
            .checked_add(c.round_seconds)
            .ok_or(CookieError::MathOverflow)?;
    }
    ctx.accounts.safety.required_reserve = winner_reserve_floor(c)?;
    Ok(())
}

/// Redraws when the drawn seat cannot or will not collect.
///
/// Without this a circle stalls on one absent member. The seat stays ineligible,
/// so a redraw cannot land on them again for the same reason.
#[derive(Accounts)]
pub struct RedrawTurn<'info> {
    #[account(
        mut,
        seeds = [CIRCLE_SEED, circle.creator.as_ref(), &circle.circle_id.to_le_bytes()],
        bump = circle.bump
    )]
    pub circle: Account<'info, Circle>,

    #[account(
        seeds = [MEMBER_SEED, circle.key().as_ref(), membership.wallet.as_ref()],
        bump = membership.bump,
        constraint = membership.circle == circle.key() @ CookieError::BadRosterMember,
        constraint = membership.seat == circle.winner_index @ CookieError::NotYourTurn
    )]
    pub membership: Account<'info, Member>,
}

pub fn handle_redraw_turn(ctx: Context<RedrawTurn>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let c = &mut ctx.accounts.circle;

    require!(
        c.state == CircleState::Running,
        CookieError::CircleNotRunning
    );
    require!(c.winner_drawn, CookieError::DrawNotFinalized);
    let selected = &ctx.accounts.membership;
    let cannot_claim = selected.has_won || !selected.active || selected.paid_round < c.round;
    require!(
        cannot_claim || now >= c.next_payout_ts.saturating_add(TURN_CLAIM_WINDOW),
        CookieError::ClaimWindowOpen
    );

    c.winner_drawn = false;
    c.draw_target_slot = 0;
    Ok(())
}

/// Takes collateral back once the circle is finished.
#[derive(Accounts)]
pub struct WithdrawBond<'info> {
    #[account(mut)]
    pub member: Signer<'info>,

    #[account(
        seeds = [CIRCLE_SEED, circle.creator.as_ref(), &circle.circle_id.to_le_bytes()],
        bump = circle.bump
    )]
    pub circle: Account<'info, Circle>,

    #[account(mut, seeds = [BOND_SEED, circle.key().as_ref()], bump = circle.bond_bump)]
    pub bond: SystemAccount<'info>,

    #[account(
        mut,
        close = member,
        seeds = [MEMBER_SEED, circle.key().as_ref(), member.key().as_ref()],
        bump = membership.bump,
        constraint = membership.wallet == member.key() @ CookieError::NotAuthority
    )]
    pub membership: Account<'info, Member>,

    pub system_program: Program<'info, System>,
}

pub fn handle_withdraw_bond(ctx: Context<WithdrawBond>) -> Result<()> {
    require!(
        ctx.accounts.circle.state == CircleState::Finished,
        CookieError::CircleNotFinished
    );

    let refund = ctx.accounts.membership.collateral;
    require!(refund > 0, CookieError::NothingToWithdraw);

    let circle_key = ctx.accounts.circle.key();
    vault_transfer(
        &ctx.accounts.system_program,
        &ctx.accounts.bond,
        &ctx.accounts.member.to_account_info(),
        refund,
        &[
            BOND_SEED,
            circle_key.as_ref(),
            &[ctx.accounts.circle.bond_bump],
        ],
    )?;
    Ok(())
}
