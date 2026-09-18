export interface CampaignDraft { name: string; description: string; contribution: string; collateral: string; seats: string; duration: string; socialUrl: string }
export const defaultDraft: CampaignDraft = { name: "", description: "", contribution: "0.1", collateral: "0.2", seats: "3", duration: "60", socialUrl: "" };
export const durationLabels: Record<string, string> = { "60": "1 minute (demo)", "86400": "1 day", "604800": "1 week", "2592000": "30 days" };
export function parseCookInput(value: string): number | null {
  if (!/^\d+(\.\d{1,9})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const lamports = BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0"));
  return lamports > 0n && lamports <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(lamports) : null;
}
export function restoreDraft(value: string | null): CampaignDraft {
  try {
    const saved: unknown = JSON.parse(value ?? "{}");
    if (!saved || typeof saved !== "object") return { ...defaultDraft };
    return Object.fromEntries(Object.entries(defaultDraft).map(([key, fallback]) => [key, typeof (saved as Record<string, unknown>)[key] === "string" ? (saved as Record<string, string>)[key] : fallback])) as unknown as CampaignDraft;
  } catch { return { ...defaultDraft }; }
}
export function isSocialPost(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    const host = url.hostname.replace(/^www\./, "");
    const path = url.pathname;
    if (host === "x.com" || host === "twitter.com") return /^\/[^/]+\/status\/\d+\/?$/.test(path);
    if (host === "instagram.com") return /^\/(p|reel)\/[^/]+\/?$/.test(path);
    if (host === "threads.net" || host === "threads.com") return /^\/@[^/]+\/post\/[^/]+\/?$/.test(path);
    if (host === "facebook.com") return /\/(posts|permalink|share)\//.test(path);
    if (host === "t.me") return /^\/[^/]+\/\d+\/?$/.test(path);
    return false;
  } catch { return false; }
}
export function validateDraft(draft: CampaignDraft, step: number): { field: keyof CampaignDraft; message: string } | null {
  const bytes = (s: string) => new TextEncoder().encode(s.trim()).length;
  if (!draft.name.trim() || bytes(draft.name) > 48) return { field: "name", message: "Enter a campaign name, up to 48 bytes." };
  if (!draft.description.trim() || bytes(draft.description) > 280) return { field: "description", message: "Enter the campaign purpose, up to 280 bytes." };
  if (step < 1) return null;
  const amount = parseCookInput(draft.contribution);
  const collateralInput = draft.collateral.trim();
  const parsedBond = parseCookInput(collateralInput);
  const bond = parsedBond ?? (/^0(?:\.0+)?$/.test(collateralInput) ? 0 : null);
  const seats = Number(draft.seats);
  if (amount === null) return { field: "contribution", message: "Enter a contribution above 0 COOK, with up to 9 decimals and within the app limit." };
  if (bond === null) return { field: "collateral", message: "Enter a positive reserve, with up to 9 decimals." };
  if (bond !== null && bond < 0) return { field: "collateral", message: "The reserve cannot be negative." };
  if (!Number.isInteger(seats) || seats < 2 || seats > 100) return { field: "seats", message: "Enter between 2 and 100 members." };
  if (!Number.isSafeInteger(amount * seats) || !Number.isSafeInteger(bond * seats)) return { field: "contribution", message: "The group total is too large. Reduce the contribution or the deposit." };
  // No floor on the deposit. It is the organiser's call how much commitment to
  // ask of their own group, and this is built for groups who already know each
  // other. `depositNote` says what a given size actually buys so the choice is
  // informed rather than blocked.
  if (!Object.hasOwn(durationLabels, draft.duration)) return { field: "duration", message: "Choose a round duration." };
  if (step < 2) return null;
  if (bytes(draft.socialUrl) > 200 || !isSocialPost(draft.socialUrl.trim())) return { field: "socialUrl", message: "Paste a public post link from X, Instagram, Threads, Facebook, or Telegram—not a profile link." };
  return null;
}

function formatLamports(lamports: number) {
  return (lamports / 1_000_000_000).toLocaleString("en-US", { maximumFractionDigits: 9 });
}

/**
 * What a deposit of this size actually does, in plain terms. Advisory only —
 * the form shows it and moves on.
 *
 * A deposit is not insurance against a member leaving with the pot; covering
 * that needs more than the pot is worth. It is a buffer for paying late, and
 * how much of one is up to the group.
 */
export function depositNote(draft: CampaignDraft): { tone: "ok" | "thin"; message: string } | null {
  const amount = parseCookInput(draft.contribution);
  const input = draft.collateral.trim();
  const bond = parseCookInput(input) ?? (/^0(?:\.0+)?$/.test(input) ? 0 : null);
  if (amount === null || bond === null) return null;

  const rounds = Math.floor(bond / amount);
  if (rounds >= 2) {
    return { tone: "ok", message: `Covers ${rounds} missed round${rounds === 1 ? "" : "s"} per member.` };
  }
  if (rounds === 1) {
    return { tone: "ok", message: "Covers one missed round per member. A second miss is not covered." };
  }
  return {
    tone: "thin",
    message: `Below one contribution, so a missed round is only partly covered and that round's pot is smaller for whoever receives it. Fine if your group trusts each other — ${formatLamports(amount * 2)} COOK would cover two misses.`,
  };
}
