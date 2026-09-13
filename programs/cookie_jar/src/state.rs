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
