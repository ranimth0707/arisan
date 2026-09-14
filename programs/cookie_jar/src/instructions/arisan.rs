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
//! 1. Somebody stops paying once they have already won. A circle may optionally
//!    use collateral and missing a round can slash it into the pot. A zero-
//!    collateral circle is still valid, but the group accepts that a missed
//!    contribution leaves that round short.
//! 2. Whoever holds the money disappears with it. Here nobody holds it. The pot
//!    lives in a program account, the draw is random and permissionless, and the
//!    organiser has no key to it and cannot change the rules after people join.

use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::CookieError,
    state::{Circle, CircleRoom, CircleState, Config, Member},
    utils::{derive_seed, fund_vault, slot_hash_for, vault_rent_floor, vault_transfer},
};

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

    pub system_program: Program<'info, System>,
}

pub fn handle_leave_circle(ctx: Context<LeaveCircle>) -> Result<()> {
    require!(
        ctx.accounts.circle.state == CircleState::Forming,
        CookieError::CircleAlreadyStarted
    );

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
    c.member_count = c.member_count.saturating_sub(1);
    Ok(())
}

/// Starts the circle. Membership closes and the first round begins.
#[derive(Accounts)]
pub struct StartCircle<'info> {
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [CIRCLE_SEED, circle.creator.as_ref(), &circle.circle_id.to_le_bytes()],
        bump = circle.bump,
        constraint = circle.creator == creator.key() @ CookieError::NotAuthority
    )]
    pub circle: Account<'info, Circle>,
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
        c.creator == ctx.accounts.creator.key() || c.member_count == c.max_members,
        CookieError::StartRequiresCreatorOrFull
    );

    c.state = CircleState::Running;
    c.round = 1;
    c.next_payout_ts = now
        .checked_add(c.round_seconds)
        .ok_or(CookieError::MathOverflow)?;
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
/// it out of the stake they posted when they joined. If their collateral runs
/// below one contribution they stop being eligible to win until they top it up,
/// so the incentive to disappear right after winning is removed.
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
    require!(taken > 0, CookieError::NothingToSlash);

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

    let m = &mut ctx.accounts.membership;
    m.collateral = m.collateral.saturating_sub(taken);
    m.rounds_missed = m.rounds_missed.saturating_add(1);
    // Counts as settled for this round so the same absence cannot be charged
    // twice, but not as a payment, which is what `rounds_paid` tracks.
    m.paid_round = round;
    if m.collateral < contribution {
        m.active = false;
    }

    let c = &mut ctx.accounts.circle;
    c.pot_amount = c
        .pot_amount
        .checked_add(taken)
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

    let required = ctx.accounts.circle.collateral;
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
    require!(!c.winner_drawn, CookieError::TurnAlreadyDrawn);

    // A request that nobody finalised in time is stale and may be replaced,
    // otherwise a skipped slot would strand the round forever.
    let stale = c.draw_target_slot != 0
        && clock.slot > c.draw_target_slot.saturating_add(FINALIZE_WINDOW_SLOTS);
    require!(
        c.draw_target_slot == 0 || stale,
        CookieError::DrawInProgress
    );

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

    let hash = slot_hash_for(
        &ctx.accounts.slot_hashes.to_account_info(),
        c.draw_target_slot,
    )
    .ok_or(CookieError::DrawExpired)?;

    // Seats are drawn, not members, because a seat number is a small dense range
    // that can be checked in one comparison. Whether that seat is actually
    // eligible is settled when the winner comes to claim.
    let key = c.key();
    let seed = derive_seed(&hash, &key, c.round as u64);
    c.winner_index = (seed % c.member_count as u64) as u16;
    c.winner_drawn = true;

    msg!("round {} drew seat {}", c.round, c.winner_index);
    Ok(())
}

/// The drawn member takes the pot, and the circle moves to the next round.
///
/// Eligibility is checked here rather than at draw time: the winner must hold
/// this seat, must not have won already, must be active, and must have paid
/// this round. A member who skipped cannot collect, which is the rule that
/// makes the whole arrangement hold together.
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
    require!(m.seat == c.winner_index, CookieError::NotYourTurn);
    require!(!m.has_won, CookieError::AlreadyHadATurn);
    require!(m.active, CookieError::MemberSidelined);
    require!(m.paid_round >= c.round, CookieError::PayFirst);
    require!(m.rounds_paid > 0, CookieError::PayFirst);

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
}

pub fn handle_redraw_turn(ctx: Context<RedrawTurn>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let c = &mut ctx.accounts.circle;

    require!(
        c.state == CircleState::Running,
        CookieError::CircleNotRunning
    );
    require!(c.winner_drawn, CookieError::DrawNotFinalized);
    require!(
        now >= c.next_payout_ts.saturating_add(TURN_CLAIM_WINDOW),
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
