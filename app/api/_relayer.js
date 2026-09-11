// Shared relayer logic, used by both the Vercel serverless functions in this
// folder and the local dev server in ../../relayer.
//
// The relayer signs as fee payer for users who hold no COOK, then reclaims the
// cost from the sponsor vault inside the same transaction. It never holds user
// funds and has no authority over any vault, so the worst a stolen key can do is
// pay fees for junk, bounded per transaction by the program itself.
//
// Every rule in validate() exists because without it the relayer is a free
// transaction service for the entire chain.

import { Connection, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { DISCRIMINATORS as DISC, PROGRAM_ADDRESS } from "./_program.js";

export const RPC_URL = process.env.RPC_URL ?? "https://rpc.cookiescan.io";
export const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID ?? PROGRAM_ADDRESS);

const COMPUTE_BUDGET = new PublicKey("ComputeBudget111111111111111111111111111111");

/** Mirrors MAX_FEE_REIMBURSEMENT in programs/cookie_jar/src/constants.rs. */
const MAX_REIMBURSEMENT = 5_000_000;

const DISCRIMINATORS = Object.fromEntries(
  Object.entries(DISC).map(([name, bytes]) => [name, Buffer.from(bytes)]),
);

/**
 * Instructions a user may have sponsored.
 *
 * The draw cranks are here because they are permissionless by design: a closed
 * jar should not need somebody holding COOK to wander past before its prize can
 * be paid out.
 *
 * deposit_gas and withdraw_gas are deliberately absent. Anyone touching a gas
 * vault demonstrably already has COOK, so sponsoring them buys nothing and only
 * widens what a stolen relayer key could be pointed at.
 */
const SPONSORABLE = new Set([
  "crack", "crack_into_jar", "deposit", "withdraw", "harvest",
  "claim_prize", "request_draw", "finalize_draw", "redraw",
  "fund_jar", "sweep_envelope",
]);

let cached = null;

/**
 * Reads the relayer key from the environment. On Vercel this is an encrypted
 * project secret, so the key never sits in the repo or on a shared host where
 * another process could read it.
 */
export function loadRelayer() {
  if (cached) return cached;

  const raw = process.env.RELAYER_SECRET_KEY?.trim();
  if (!raw) throw new Error("RELAYER_SECRET_KEY is not set");

  const bytes = raw.startsWith("[")
    ? Uint8Array.from(JSON.parse(raw))
    : decodeBase58(raw);

  cached = {
    keypair: Keypair.fromSecretKey(bytes),
    connection: new Connection(RPC_URL, "confirmed"),
  };
  return cached;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function decodeBase58(str) {
  let num = 0n;
  for (const ch of str) {
    const i = B58.indexOf(ch);
    if (i < 0) throw new Error("RELAYER_SECRET_KEY is not valid base58");
    num = num * 58n + BigInt(i);
  }
  const bytes = [];
  while (num > 0n) {
    bytes.unshift(Number(num % 256n));
    num /= 256n;
  }
  for (const ch of str) {
    if (ch !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

function identify(data) {
  const head = Buffer.from(data.subarray(0, 8));
  for (const [name, disc] of Object.entries(DISCRIMINATORS)) {
    if (head.equals(disc)) return name;
  }
  return null;
}

/** Throws unless this is a transaction the relayer is willing to pay for. */
export function validate(tx, relayerPubkey) {
  const msg = tx.message;
  const keys = msg.staticAccountKeys;

  if (msg.addressTableLookups?.length) {
    throw new Error("address lookup tables are not accepted");
  }

  if (!keys[0].equals(relayerPubkey)) {
    throw new Error("fee payer must be the relayer");
  }

  const ixs = msg.compiledInstructions;
  if (ixs.length === 0) throw new Error("empty transaction");
  if (ixs.length > 4) throw new Error("too many instructions");

  let sawReimburse = false;
  let sawSponsorable = false;

  for (const [i, ix] of ixs.entries()) {
    const programId = keys[ix.programIdIndex];
    if (programId.equals(COMPUTE_BUDGET)) continue;

    if (!programId.equals(PROGRAM_ID)) {
      throw new Error(`instruction ${i} targets a foreign program`);
    }

    const name = identify(Buffer.from(ix.data));
    if (!name) throw new Error(`instruction ${i} is unrecognised`);

    if (name === "reimburse_relayer") {
      if (sawReimburse) throw new Error("more than one reimbursement");
      sawReimburse = true;
      const amount = Buffer.from(ix.data).readBigUInt64LE(8);
      if (amount > BigInt(MAX_REIMBURSEMENT)) {
        throw new Error("reimbursement above the cap");
      }
      continue;
    }

    if (!SPONSORABLE.has(name)) throw new Error(`${name} is not sponsorable`);
    sawSponsorable = true;
  }

  if (!sawReimburse) throw new Error("no reimbursement instruction");
  if (!sawSponsorable) throw new Error("nothing to sponsor");

  // The relayer pays and gets reimbursed. It must not appear anywhere else,
  // where a program could mistake it for an authority.
  for (const [i, key] of keys.entries()) {
    if (i !== 0 && key.equals(relayerPubkey)) {
      throw new Error("relayer appears as a non-fee-payer account");
    }
  }
}

// Best effort only. Serverless instances do not share memory, so this thins out
// bursts rather than enforcing a hard ceiling. The real bound on abuse is the
// on-chain per-transaction cap: draining a 50 COOK vault takes 10,000 separate
// transactions and costs the protocol about half a cent.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
const hits = new Map();

export function rateLimited(key) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) return true;
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}

/** Validates, signs as fee payer and broadcasts. */
export async function sponsor(base64Transaction) {
  const { keypair, connection } = loadRelayer();

  let tx;
  try {
    tx = VersionedTransaction.deserialize(Buffer.from(base64Transaction, "base64"));
  } catch {
    const err = new Error("could not decode the transaction");
    err.status = 400;
    throw err;
  }

  try {
    validate(tx, keypair.publicKey);
  } catch (e) {
    e.status = 400;
    throw e;
  }

  try {
    tx.sign([keypair]);
    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });
    return { signature };
  } catch (e) {
    const err = new Error(e?.message ?? "broadcast failed");
    err.status = 502;
    err.logs = (e?.logs ?? e?.transactionLogs)?.slice(-6);
    throw err;
  }
}

export async function health() {
  const { keypair, connection } = loadRelayer();
  return {
    ok: true,
    relayer: keypair.publicKey.toBase58(),
    program: PROGRAM_ID.toBase58(),
    balanceLamports: await connection.getBalance(keypair.publicKey),
    rpc: RPC_URL,
  };
}
