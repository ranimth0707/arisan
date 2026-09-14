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

    #[msg("A campaign needs a title")]
    TitleRequired,
    #[msg("Campaign title is too long")]
    TitleTooLong,
    #[msg("Campaign story is too long")]
    StoryTooLong,
    #[msg("This campaign is closed")]
    CampaignClosed,
    #[msg("This campaign has passed its deadline")]
    CampaignEnded,
    #[msg("Not that much has been raised")]
    NothingRaised,

    #[msg("A circle needs between 2 and 100 seats")]
    BadMemberCount,
    #[msg("Round length is outside the allowed range")]
    BadRoundLength,
    /// Retained so upgrades do not renumber the public error table. New circles
    /// may use zero collateral; this error is no longer emitted by creation.
    #[msg("Collateral must cover at least one contribution")]
    CollateralTooSmall,
    #[msg("This circle has already started")]
    CircleAlreadyStarted,
    #[msg("This circle is not running")]
    CircleNotRunning,
    #[msg("This circle has not finished")]
    CircleNotFinished,
    #[msg("Every seat is taken")]
    CircleFull,
    #[msg("A circle needs at least two members to start")]
    CircleTooSmall,
    #[msg("You have already settled this round")]
    AlreadyPaidThisRound,
    #[msg("The round is not over yet")]
    RoundNotOver,
    #[msg("There is no collateral left to slash")]
    NothingToSlash,
    #[msg("This round has already been drawn")]
    TurnAlreadyDrawn,
    #[msg("This round is not yours")]
    NotYourTurn,
    #[msg("You have already had your turn")]
    AlreadyHadATurn,
    #[msg("Top your collateral back up first")]
    MemberSidelined,
    #[msg("Pay this round before collecting it")]
    PayFirst,
    #[msg("The pot is empty")]
    PotEmpty,
    #[msg("There is nothing to withdraw")]
    NothingToWithdraw,
    #[msg("Only the creator can start a circle before all seats are filled")]
    StartRequiresCreatorOrFull,
    #[msg("A campaign needs a description")]
    RoomDescriptionRequired,
    #[msg("The social post link is required")]
    SocialPostRequired,
    #[msg("The social post link is invalid")]
    InvalidSocialPost,
    #[msg("This room needs an invite code")]
    InviteCodeRequired,
    #[msg("That invite code does not open this room")]
    InviteCodeMismatch,
    #[msg("This circle has no campaign room yet")]
    RoomRequired,
    #[msg("The circle winner roster is not ready yet")]
    RosterNotReady,
    #[msg("The winner roster does not belong to this circle")]
    RosterMismatch,
    #[msg("A supplied roster member is invalid")]
    BadRosterMember,
    #[msg("No member remains eligible for a turn")]
    NoEligibleMembers,
}
