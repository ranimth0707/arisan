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
  if (!member) return "Data anggota belum tersedia.";
  if (member.hasWon) return "Kursi ini sudah menerima kas pada putaran sebelumnya.";
  if (!member.active) return "Anggota perlu mengisi ulang jaminan sebelum mengambil kas.";
  if (member.paidRound < round) return "Anggota perlu menyelesaikan iuran atau menutupnya dari cadangan sebelum mengambil kas.";
  return null;
}
