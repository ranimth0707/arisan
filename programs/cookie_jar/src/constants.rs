use anchor_lang::prelude::*;

// PDA seeds
#[constant]
pub const CONFIG_SEED: &[u8] = b"config";
#[constant]
pub const SPONSOR_SEED: &[u8] = b"sponsor";
#[constant]
pub const SPONSOR_VAULT_SEED: &[u8] = b"sponsor_vault";
#[constant]
pub const JAR_SEED: &[u8] = b"jar";
#[constant]
pub const JAR_VAULT_SEED: &[u8] = b"jar_vault";
#[constant]
pub const REWARD_VAULT_SEED: &[u8] = b"reward_vault";
#[constant]
pub const POSITION_SEED: &[u8] = b"position";
#[constant]
pub const ENVELOPE_SEED: &[u8] = b"envelope";
#[constant]
pub const ENVELOPE_VAULT_SEED: &[u8] = b"envelope_vault";
#[constant]
pub const CLAIM_SEED: &[u8] = b"claim";
#[constant]
pub const CAMPAIGN_SEED: &[u8] = b"campaign";
#[constant]
pub const CAMPAIGN_VAULT_SEED: &[u8] = b"campaign_vault";
#[constant]
pub const DONATION_SEED: &[u8] = b"donation";
#[constant]
pub const CIRCLE_SEED: &[u8] = b"circle";
#[constant]
pub const ROOM_SEED: &[u8] = b"room";
#[constant]
pub const POT_SEED: &[u8] = b"pot";
#[constant]
pub const BOND_SEED: &[u8] = b"bond";
#[constant]
pub const MEMBER_SEED: &[u8] = b"member";
#[constant]
pub const ROSTER_SEED: &[u8] = b"roster";
#[constant]
pub const SAFETY_SEED: &[u8] = b"safety";

/// Fixed-point scale for the reward-per-share accumulator.
pub const ACC_PRECISION: u128 = 1_000_000_000_000;

/// Hard cap on what the relayer may reclaim per sponsored transaction.
///
/// It covers two things the relayer fronts on a user's behalf: the transaction
/// fee (10,000 lamports observed on Cookie Chain) and the rent for any account
/// the instruction opens, which is about 3.3M lamports for a position plus a
/// claim record. The cap is what bounds the damage if the relayer key leaks:
/// draining a 2,000 COOK vault would take 400,000 separate transactions.
#[constant]
pub const MAX_FEE_REIMBURSEMENT: u64 = 5_000_000;

/// Slots between requesting a draw and the slot whose hash seeds it. The seed
/// does not exist yet when the draw is requested, so the caller cannot pick a
/// favourable moment.
pub const DRAW_SLOT_DELAY: u64 = 3;

/// How long after the target slot a draw may still be finalized.
///
/// Without this bound, stalling the finalize would let the caller reach back to
/// an old slot hash they had already seen and retry until the result suited
/// them. Past the window the draw is stale and has to be requested again, which
/// commits to a fresh unknown slot. SlotHashes retains 512 entries, so this
/// stays comfortably inside what the sysvar can still prove.
pub const FINALIZE_WINDOW_SLOTS: u64 = 300;

/// How long a Lucky winner has to claim before anyone may trigger a re-draw.
pub const PRIZE_CLAIM_WINDOW: i64 = 60 * 60 * 24;

pub const MIN_JAR_DURATION: i64 = 60;
pub const MAX_JAR_DURATION: i64 = 60 * 60 * 24 * 365;
pub const MAX_ENVELOPE_CLAIMS: u16 = 1000;
pub const MAX_JAR_NAME_LEN: usize = 32;
pub const MAX_ENVELOPE_MESSAGE_LEN: usize = 64;
pub const MAX_CAMPAIGN_TITLE_LEN: usize = 64;
pub const MAX_CAMPAIGN_STORY_LEN: usize = 280;
pub const MAX_CIRCLE_NAME_LEN: usize = 48;
pub const MAX_CIRCLE_DESCRIPTION_LEN: usize = 280;
pub const MAX_CIRCLE_SOCIAL_URL_LEN: usize = 200;

/// Two is the smallest arrangement that is still a circle. The ceiling keeps a
/// seat number inside a u16 and keeps the draw cheap.
pub const MAX_CIRCLE_MEMBERS: u16 = 100;

/// A minute is short enough to demo a full cycle, a year long enough for a real
/// monthly circle.
pub const MIN_ROUND_SECONDS: i64 = 60;
pub const MAX_ROUND_SECONDS: i64 = 60 * 60 * 24 * 60;

/// How long the drawn seat has to collect before anyone may redraw. Without it
/// one absent member stalls everybody else's money indefinitely.
pub const TURN_CLAIM_WINDOW: i64 = 60 * 60 * 24;

/// Floor for any single envelope share, so a Surprise split can never hand out
/// a zero amount.
pub const MIN_ENVELOPE_SHARE: u64 = 1_000;
