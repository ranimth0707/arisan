use anchor_lang::prelude::*;

use crate::{constants::*, error::CookieError};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum JarMode {
    /// Rewards stream continuously, weighted by amount multiplied by time held.
    Proportional,
    /// One entry per depositor at or above `min_deposit`, regardless of size.
    /// The whole reward pool goes to a single winner.
    Lucky,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum DrawState {
    NotStarted,
    Requested,
    Finalized,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum SplitMode {
    /// Every claimer gets the same share.
    Equal,
    /// Each claimer gets a random share, like a red envelope.
    Surprise,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    /// Hot wallet that pays transaction fees. Fee payer only. It is never an
    /// authority over any vault in this program.
    pub relayer: Pubkey,
    /// Blocks new deposits. Withdrawals and harvests stay open.
    pub paused: bool,
    pub jar_count: u64,
    pub envelope_count: u64,
    /// No campaign counter here on purpose. This account is already live on
    /// mainnet at its original size, and adding a field would push it past the
    /// space it was allocated. Campaigns are counted by listing them instead.
    pub bump: u8,
}

/// A request for help. Anyone can open one, there is no approval step and no
/// platform cut, because the person asking is usually the one who can least
/// afford either.
#[account]
#[derive(InitSpace)]
pub struct Campaign {
    pub creator: Pubkey,
    pub campaign_id: u64,
    #[max_len(MAX_CAMPAIGN_TITLE_LEN)]
    pub title: String,
    #[max_len(MAX_CAMPAIGN_STORY_LEN)]
    pub story: String,
    pub target: u64,
    pub raised: u64,
    pub withdrawn: u64,
    /// Distinct wallets, not gifts. Giving twice does not inflate it.
    pub donor_count: u64,
    pub donation_count: u64,
    pub deadline_ts: i64,
    pub closed: bool,
    pub bump: u8,
    pub vault_bump: u8,
}

/// One per wallet per campaign. Its existence is what makes an honest donor
/// count possible, and it doubles as the public record of who helped.
#[account]
#[derive(InitSpace)]
pub struct Donation {
    pub campaign: Pubkey,
    pub donor: Pubkey,
    pub total: u64,
    pub times: u16,
    pub first_ts: i64,
    pub last_ts: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum CircleState {
    /// Taking members. Anyone may still join or leave.
    Forming,
    /// Rounds are running. Membership is closed.
    Running,
    /// Everyone has had a turn. Collateral can be withdrawn.
    Finished,
}

/// A rotating savings circle.
///
/// Every field below is written once at creation and never changed, which is the
/// reason anybody should be willing to join one: the organiser cannot raise the
/// contribution or change the collateral policy after money is committed.
#[account]
#[derive(InitSpace)]
pub struct Circle {
    pub creator: Pubkey,
    pub circle_id: u64,
    #[max_len(MAX_CIRCLE_NAME_LEN)]
    pub name: String,

    /// Owed by every member, every round.
    pub contribution: u64,
    /// Fixed reserve posted on joining. New circles require this to cover every
    /// planned contribution; legacy circles may contain a smaller value but are
    /// blocked by CircleSafety until the remaining reserve is repaired.
    pub collateral: u64,
    pub max_members: u16,
    pub round_seconds: i64,

    pub state: CircleState,
    pub member_count: u16,
    pub round: u16,
    pub next_payout_ts: i64,
    pub paid_this_round: u16,
    /// What the pot holds right now. Reset to zero when a turn is collected.
    pub pot_amount: u64,
    pub winners_so_far: u16,

    pub draw_target_slot: u64,
    pub winner_index: u16,
    pub winner_drawn: bool,

    pub bump: u8,
    pub pot_bump: u8,
    pub bond_bump: u8,
}

/// Public campaign details and the invite gate for a circle.
///
/// Kept in its own PDA so adding room metadata does not invalidate Circle
/// accounts that were created before campaign rooms existed.
#[account]
#[derive(InitSpace)]
pub struct CircleRoom {
    pub circle: Pubkey,
    pub creator: Pubkey,
    #[max_len(MAX_CIRCLE_DESCRIPTION_LEN)]
    pub description: String,
    #[max_len(MAX_CIRCLE_SOCIAL_URL_LEN)]
    pub social_url: String,
    pub invite_code_hash: [u8; 32],
    pub bump: u8,
}

/// One per wallet per circle. The public ledger everyone in the group can read:
/// what you posted, what you paid, what you missed, whether you have had a turn.
#[account]
#[derive(InitSpace)]
pub struct Member {
    pub circle: Pubkey,
    pub wallet: Pubkey,
    /// Position in the circle, and what the draw selects.
    pub seat: u16,
    pub collateral: u64,
    /// Last round this member settled, by paying or by being slashed.
    pub paid_round: u16,
    pub rounds_paid: u16,
    pub rounds_missed: u16,
    pub has_won: bool,
    /// False once collateral no longer covers this member's remaining
    /// obligations. Protected circles will not advance until this is restored.
    pub active: bool,
    pub joined_ts: i64,
    pub bump: u8,
}

/// Compact eligibility ledger for a circle.
///
/// `Circle` predates winner elimination and is already live at its original
/// size, so changing that account would make every existing circle unreadable.
/// This companion PDA keeps two 100-seat bitmaps instead: one authoritative
/// winner set and one migration-progress set for circles that were already
/// running when the roster was introduced.
#[account]
#[derive(InitSpace)]
pub struct CircleRoster {
    pub circle: Pubkey,
    pub winner_mask: [u64; 2],
    pub synced_mask: [u64; 2],
    pub ready: bool,
    pub bump: u8,
}

/// Solvency guard for a circle.
///
/// A protected circle has enough per-member reserve to cover every remaining
/// contribution. It is deliberately separate from CircleRoster so this safety
/// upgrade can be added without changing either of the already-live accounts.
#[account]
#[derive(InitSpace)]
pub struct CircleSafety {
    pub circle: Pubkey,
    pub required_reserve: u64,
    pub secured_mask: [u64; 2],
    pub protected: bool,
    pub bump: u8,
}

impl CircleSafety {
    pub fn is_fully_secured(&self, member_count: u16) -> bool {
        self.secured_mask == CircleRoster::full_mask(member_count)
    }

    pub fn mark_secured(&mut self, seat: u16) {
        let word = usize::from(seat / 64);
        self.secured_mask[word] |= 1u64 << u32::from(seat % 64);
    }
}

impl CircleRoster {
    pub fn full_mask(member_count: u16) -> [u64; 2] {
        let low_count = member_count.min(64) as u32;
        let high_count = member_count.saturating_sub(64) as u32;
        [
            if low_count == 64 {
                u64::MAX
            } else if low_count == 0 {
                0
            } else {
                (1u64 << low_count) - 1
            },
            if high_count == 64 {
                u64::MAX
            } else if high_count == 0 {
                0
            } else {
                (1u64 << high_count) - 1
            },
        ]
    }

    fn bit(seat: u16) -> (usize, u64) {
        let word = usize::from(seat / 64);
        let bit = 1u64 << u32::from(seat % 64);
        (word, bit)
    }

    pub fn mark_synced(&mut self, seat: u16) {
        let (word, bit) = Self::bit(seat);
        self.synced_mask[word] |= bit;
    }

    pub fn mark_winner(&mut self, seat: u16) {
        let (word, bit) = Self::bit(seat);
        self.winner_mask[word] |= bit;
    }

    pub fn is_winner(&self, seat: u16) -> bool {
        let (word, bit) = Self::bit(seat);
        self.winner_mask[word] & bit != 0
    }

    pub fn is_fully_synced(&self, member_count: u16) -> bool {
        self.synced_mask == Self::full_mask(member_count)
    }

    pub fn winner_count(&self) -> u16 {
        (self.winner_mask[0].count_ones() + self.winner_mask[1].count_ones()) as u16
    }

    /// Maps a random rank in the remaining population back to its real seat.
    pub fn select_unwon(&self, member_count: u16, mut rank: u16) -> Option<u16> {
        for seat in 0..member_count {
            if self.is_winner(seat) {
                continue;
            }
            if rank == 0 {
                return Some(seat);
            }
            rank = rank.saturating_sub(1);
        }
        None
    }
}

#[cfg(test)]
mod circle_roster_tests {
    use super::CircleRoster;

    fn roster(winners: &[u16]) -> CircleRoster {
        let mut roster = CircleRoster {
            circle: Default::default(),
            winner_mask: [0; 2],
            synced_mask: [0; 2],
            ready: true,
            bump: 0,
        };
        for seat in winners {
            roster.mark_winner(*seat);
        }
        roster
    }

    #[test]
    fn two_members_leave_only_the_other_seat() {
        let r = roster(&[1]);
        assert_eq!(r.select_unwon(2, 0), Some(0));
        assert_eq!(r.select_unwon(2, 1), None);
    }

    #[test]
    fn five_members_skip_every_prior_winner() {
        let r = roster(&[1, 3]);
        assert_eq!(r.select_unwon(5, 0), Some(0));
        assert_eq!(r.select_unwon(5, 1), Some(2));
        assert_eq!(r.select_unwon(5, 2), Some(4));
    }

    #[test]
    fn bitmap_handles_the_sixty_four_bit_boundary_and_hundred_seats() {
        let full = CircleRoster::full_mask(100);
        assert_eq!(full[0], u64::MAX);
        assert_eq!(full[1].count_ones(), 36);
        let r = roster(&[0, 63, 64, 99]);
        assert!(r.is_winner(63));
        assert!(r.is_winner(64));
        assert_eq!(r.winner_count(), 4);
    }
}

/// One per sponsor. Sponsors fund their own users' gas rather than drawing from
/// a shared pool, so nobody can spend someone else's balance.
#[account]
#[derive(InitSpace)]
pub struct Sponsor {
    pub authority: Pubkey,
    pub total_deposited: u64,
    pub total_spent: u64,
    pub tx_sponsored: u64,
    pub bump: u8,
    pub vault_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Jar {
    pub creator: Pubkey,
    pub jar_id: u64,
    #[max_len(MAX_JAR_NAME_LEN)]
    pub name: String,
    pub mode: JarMode,

    pub start_ts: i64,
    pub end_ts: i64,

    /// Total rewards ever funded into this jar.
    pub reward_total: u64,
    /// Rewards accounted as streamed so far (Proportional only).
    pub reward_distributed: u64,
    /// Rewards actually paid out.
    pub reward_claimed: u64,
    /// Lamports per second (Proportional only).
    pub reward_rate: u64,

    /// Principal currently held in the jar vault. This is the TVL figure.
    pub total_deposited: u64,
    pub depositor_count: u64,

    /// Reward-per-share accumulator, scaled by ACC_PRECISION.
    pub acc_reward_per_share: u128,
    pub last_update_ts: i64,

    /// Entries handed out so far (Lucky only).
    pub entry_count: u64,
    pub min_deposit: u64,

    pub draw_state: DrawState,
    pub draw_target_slot: u64,
    pub winner_index: u64,
    pub winner: Option<Pubkey>,
    pub prize_claimed: bool,

    pub bump: u8,
    pub vault_bump: u8,
    pub reward_vault_bump: u8,
}

impl Jar {
    /// Settles the accumulator up to `now`. Must run before any change to
    /// `total_deposited` or to a position's `amount`.
    pub fn update(&mut self, now: i64) -> Result<()> {
        if self.mode != JarMode::Proportional {
            self.last_update_ts = now;
            return Ok(());
        }

        let capped_now = now.min(self.end_ts);
        let from = self.last_update_ts.max(self.start_ts);

        if capped_now <= from || self.total_deposited == 0 {
            // Nothing streamed, but still move the checkpoint forward so idle
            // time before the first deposit is not paid out later.
            self.last_update_ts = now;
            return Ok(());
        }

        let elapsed = (capped_now - from) as u64;
        let undistributed = self
            .reward_total
            .checked_sub(self.reward_distributed)
            .ok_or(CookieError::MathOverflow)?;

        let minted = elapsed
            .checked_mul(self.reward_rate)
            .ok_or(CookieError::MathOverflow)?
            .min(undistributed);

        if minted > 0 {
            let delta = (minted as u128)
                .checked_mul(ACC_PRECISION)
                .ok_or(CookieError::MathOverflow)?
                .checked_div(self.total_deposited as u128)
                .ok_or(CookieError::MathOverflow)?;

            self.acc_reward_per_share = self
                .acc_reward_per_share
                .checked_add(delta)
                .ok_or(CookieError::MathOverflow)?;

            self.reward_distributed = self
                .reward_distributed
                .checked_add(minted)
                .ok_or(CookieError::MathOverflow)?;
        }

        self.last_update_ts = now;
        Ok(())
    }

    /// Recomputes the streaming rate over whatever reward budget and time are
    /// left. Called after any change to `reward_total`.
    pub fn recompute_rate(&mut self, now: i64) -> Result<()> {
        if self.mode != JarMode::Proportional {
            return Ok(());
        }

        let start = now.max(self.start_ts);
        if self.end_ts <= start {
            self.reward_rate = 0;
            return Ok(());
        }

        let remaining_time = (self.end_ts - start) as u64;
        let undistributed = self
            .reward_total
            .checked_sub(self.reward_distributed)
            .ok_or(CookieError::MathOverflow)?;

        self.reward_rate = undistributed / remaining_time;
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub jar: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    /// Accumulator checkpoint, scaled by ACC_PRECISION.
    pub reward_debt: u128,
    /// Settled but not yet transferred.
    pub pending: u64,
    pub rewards_claimed: u64,
    /// Entry number for Lucky jars. Meaningless unless `has_entry`.
    pub entry_index: u64,
    pub has_entry: bool,
    pub first_deposit_ts: i64,
    pub bump: u8,
}

impl Position {
    /// Moves everything earned since the last checkpoint into `pending`.
    pub fn settle(&mut self, acc_reward_per_share: u128) -> Result<()> {
        let accrued = (self.amount as u128)
            .checked_mul(acc_reward_per_share)
            .ok_or(CookieError::MathOverflow)?
            .checked_div(ACC_PRECISION)
            .ok_or(CookieError::MathOverflow)?;

        let earned = accrued.saturating_sub(self.reward_debt);

        self.pending = self
            .pending
            .checked_add(u64::try_from(earned).map_err(|_| CookieError::MathOverflow)?)
            .ok_or(CookieError::MathOverflow)?;

        self.reward_debt = accrued;
        Ok(())
    }

    /// Resets the checkpoint after `amount` changes.
    pub fn sync_debt(&mut self, acc_reward_per_share: u128) -> Result<()> {
        self.reward_debt = (self.amount as u128)
            .checked_mul(acc_reward_per_share)
            .ok_or(CookieError::MathOverflow)?
            .checked_div(ACC_PRECISION)
            .ok_or(CookieError::MathOverflow)?;
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Envelope {
    pub creator: Pubkey,
    pub envelope_id: u64,
    #[max_len(MAX_ENVELOPE_MESSAGE_LEN)]
    pub message: String,
    pub total_amount: u64,
    pub remaining: u64,
    pub claims_total: u16,
    pub claims_done: u16,
    pub split: SplitMode,
    pub expiry_ts: i64,
    pub swept: bool,
    pub bump: u8,
    pub vault_bump: u8,
}

/// Existence of this account is the proof that a wallet already claimed.
/// Creating it twice fails at the runtime level, so double claims are
/// impossible rather than merely checked.
#[account]
#[derive(InitSpace)]
pub struct EnvelopeClaim {
    pub envelope: Pubkey,
    pub claimer: Pubkey,
    pub amount: u64,
    pub claimed_at: i64,
    /// True when the claim went straight into a jar instead of a wallet.
    pub into_jar: bool,
    pub bump: u8,
}
