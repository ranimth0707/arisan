use anchor_lang::prelude::*;

#[error_code]
pub enum CookieError {
    #[msg("Protocol is paused")]
    Paused,
    #[msg("Only the config authority may do this")]
    NotAuthority,
    #[msg("Only the registered relayer may do this")]
    NotRelayer,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,

    #[msg("Reimbursement exceeds the per-transaction cap")]
    ReimbursementTooLarge,
    #[msg("Sponsor vault does not hold enough COOK")]
    SponsorBalanceTooLow,

    #[msg("Jar duration is outside the allowed range")]
    BadJarDuration,
    #[msg("Jar start time is in the past")]
    StartInPast,
    #[msg("Jar name is too long")]
    NameTooLong,
    #[msg("Jar reward window has already ended")]
    JarEnded,
    #[msg("Jar reward window has not ended yet")]
    JarNotEnded,
    #[msg("Deposit is below the jar minimum")]
    BelowMinDeposit,
    #[msg("Position does not hold that much")]
    InsufficientPosition,
    #[msg("Reward vault does not hold enough COOK")]
    RewardVaultTooLow,
    #[msg("Nothing to harvest")]
    NothingToHarvest,
    #[msg("This instruction is for Proportional jars only")]
    NotProportionalJar,
    #[msg("This instruction is for Lucky jars only")]
    NotLuckyJar,

    #[msg("Jar has no eligible entries to draw from")]
    NoEntries,
    #[msg("A draw is already in progress")]
    DrawInProgress,
    #[msg("No draw has been requested")]
    DrawNotRequested,
    #[msg("Target slot has not been reached yet")]
    DrawTooEarly,
    #[msg("Target slot has aged out of SlotHashes, request the draw again")]
    DrawExpired,
    #[msg("Draw has not been finalized")]
    DrawNotFinalized,
    #[msg("This position did not win")]
    NotWinner,
    #[msg("Prize has already been claimed")]
    PrizeAlreadyClaimed,
    #[msg("The claim window has not closed yet")]
    ClaimWindowOpen,
    #[msg("Winner no longer meets the jar minimum")]
    WinnerIneligible,

    #[msg("Envelope message is too long")]
    MessageTooLong,
    #[msg("Envelope claim count is outside the allowed range")]
    BadClaimCount,
    #[msg("Envelope amount is too small for that many claims")]
    EnvelopeTooSmall,
    #[msg("Envelope has no claims left")]
    EnvelopeEmpty,
    #[msg("Envelope has expired")]
    EnvelopeExpired,
    #[msg("Envelope has not expired yet")]
    EnvelopeNotExpired,
    #[msg("Expiry must be in the future")]
    BadExpiry,
    #[msg("Envelope and jar do not use the same vault owner")]
    JarMismatch,
}
