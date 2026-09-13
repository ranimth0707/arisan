// Program constants, PDA derivation and typed helpers.
// Seeds must stay in lockstep with programs/cookie_jar/src/constants.rs.

import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import idl from "./idl.json";
import type { CookieJar } from "./cookie_jar_type";

export type CookieJarProgram = Program<CookieJar>;

export const RPC_URL = "https://rpc.cookiescan.io";
export const EXPLORER = "https://cookiescan.io";
// Same origin. In production these are Vercel functions next to the app, in
// development Vite proxies them to relayer/dev-server.js. Keeping it relative
// means no CORS and no mixed-content block when the site is served over HTTPS.
export const RELAYER_API = "/api";

export const PROGRAM_ID = new PublicKey(idl.address);
export const LAMPORTS_PER_COOK = 1_000_000_000;
export const SLOT_HASHES = new PublicKey("SysvarS1otHashes111111111111111111111111111");

/** Mirrors MAX_FEE_REIMBURSEMENT on-chain. */
export const MAX_REIMBURSEMENT = 5_000_000;

export type JarMode = "proportional" | "lucky";
export type SplitMode = "equal" | "surprise";

const seed = (s: string) => new TextEncoder().encode(s);
const u64 = (n: number | bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
  return b;
};
const pda = (parts: Uint8Array[]) => PublicKey.findProgramAddressSync(parts, PROGRAM_ID)[0];

export const findConfig = () => pda([seed("config")]);
export const findSponsor = (a: PublicKey) => pda([seed("sponsor"), a.toBytes()]);
export const findSponsorVault = (a: PublicKey) => pda([seed("sponsor_vault"), a.toBytes()]);
export const findJar = (creator: PublicKey, id: number | bigint) =>
  pda([seed("jar"), creator.toBytes(), u64(id)]);
export const findJarVault = (jar: PublicKey) => pda([seed("jar_vault"), jar.toBytes()]);
export const findRewardVault = (jar: PublicKey) => pda([seed("reward_vault"), jar.toBytes()]);
export const findPosition = (jar: PublicKey, owner: PublicKey) =>
  pda([seed("position"), jar.toBytes(), owner.toBytes()]);
export const findEnvelope = (creator: PublicKey, id: number | bigint) =>
  pda([seed("envelope"), creator.toBytes(), u64(id)]);
export const findEnvelopeVault = (e: PublicKey) => pda([seed("envelope_vault"), e.toBytes()]);
export const findClaim = (e: PublicKey, claimer: PublicKey) =>
  pda([seed("claim"), e.toBytes(), claimer.toBytes()]);
export const findCampaign = (creator: PublicKey, id: number | bigint) =>
  pda([seed("campaign"), creator.toBytes(), u64(id)]);
export const findCampaignVault = (c: PublicKey) => pda([seed("campaign_vault"), c.toBytes()]);
export const findDonation = (c: PublicKey, donor: PublicKey) =>
  pda([seed("donation"), c.toBytes(), donor.toBytes()]);

export const connection = new Connection(RPC_URL, "confirmed");

export function getProgram(wallet: AnchorProvider["wallet"]): CookieJarProgram {
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  return new Program(idl as CookieJar, provider);
}

/** Read-only program handle for pages that work before a wallet connects. */
export function getReadOnlyProgram(): CookieJarProgram {
  const dummy = {
    publicKey: PublicKey.default,
    signTransaction: async (t: never) => t,
    signAllTransactions: async (t: never) => t,
  };
  return getProgram(dummy as never);
}

export const bn = (n: number | string | bigint) => new BN(n.toString());
export const toLamports = (cook: number) => Math.round(cook * LAMPORTS_PER_COOK);
export const toCook = (lamports: number | BN | bigint) => {
  const n = typeof lamports === "number" ? lamports : Number(lamports.toString());
  return n / LAMPORTS_PER_COOK;
};

// Pinned to en-US so the decimal separator does not flip with the visitor's
// locale. Mixed separators in the same view read as a bug.
export function formatCook(lamports: number | BN | bigint, digits = 4) {
  return toCook(lamports).toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function formatCount(n: number) {
  return n.toLocaleString("en-US");
}

/**
 * Reads many balances in one round trip. One RPC call per account made the jar
 * list take a visible pause to appear, and it scales linearly with the number
 * of jars. getMultipleAccountsInfo caps at 100 accounts, hence the chunking.
 */
export async function getBalances(addresses: PublicKey[]): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < addresses.length; i += 100) {
    const chunk = addresses.slice(i, i + 100);
    const infos = await connection.getMultipleAccountsInfo(chunk);
    out.push(...infos.map((info) => info?.lamports ?? 0));
  }
  return out;
}

/**
 * Some actions inherently spend the user's own COOK: filling a cookie, opening a
 * jar with a prize, topping up a pool. Sponsorship covers the fee, never the
 * money being given away. Checking first turns a raw
 * "Transfer: insufficient lamports 0" into something a person can act on.
 */
export async function assertCanAfford(owner: PublicKey, lamports: number, what: string) {
  const balance = await connection.getBalance(owner);
  // Leave room for the account rent this will also open.
  const needed = lamports + 2_000_000;
  if (balance >= needed) return;
  throw new Error(
    `You need about ${formatCook(needed)} COOK to ${what}, and this wallet holds ` +
    `${formatCook(balance)}. Gas is covered for you, but the COOK you give away ` +
    `has to be yours.`,
  );
}

export function txUrl(signature: string) {
  return `${EXPLORER}/tx/${signature}`;
}

export function countdown(endTs: number) {
  const left = endTs - Math.floor(Date.now() / 1000);
  if (left <= 0) return "closed";
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * Turns an Anchor or RPC failure into something a person can act on.
 * Raw Solana errors are unreadable, and the bounty asks for real error handling.
 */
export function readableError(e: unknown): string {
  const err = e as { message?: string; error?: { errorMessage?: string } };
  const anchorMsg = err?.error?.errorMessage;
  if (anchorMsg) return anchorMsg;

  const msg = err?.message ?? String(e);
  if (msg.includes("User rejected") || msg.includes("rejected the request")) {
    return "You cancelled the request in your wallet.";
  }
  if (msg.includes("insufficient lamports") || msg.includes("Insufficient")) {
    return "Not enough COOK to cover this.";
  }
  if (msg.includes("Blockhash not found") || msg.includes("block height exceeded")) {
    return "The network took too long to confirm. Try again.";
  }
  if (msg.includes("already in use")) {
    return "That already exists on chain.";
  }
  if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
    return "Could not reach the network. Check your connection.";
  }
  return msg;
}
