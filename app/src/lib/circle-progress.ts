// Mirrors FINALIZE_WINDOW_SLOTS and TURN_CLAIM_WINDOW in the deployed program.
export const FINALIZE_WINDOW_SLOTS = 300;
export const TURN_CLAIM_WINDOW = 86400;

export function drawPhase(targetSlot: number, slot: number | null) {
  if (!targetSlot) return "request";
  if (slot === null) return "loading";
  if (slot < targetSlot) return "waiting";
  return slot > targetSlot + FINALIZE_WINDOW_SLOTS ? "expired" : "finalize";
}

export function claimBlocker(member: { hasWon: boolean; active: boolean; paidRound: number } | undefined, round: number) {
  if (!member) return "Member data is not available yet.";
  if (member.hasWon) return "This seat already received the pool in an earlier round.";
  if (!member.active) return "This member must top up the reserve before collecting the pool.";
  if (member.paidRound < round) return "This member must pay the contribution or cover it from the reserve before collecting the pool.";
  return null;
}
