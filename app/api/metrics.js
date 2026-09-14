import { BorshAccountsCoder } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import idl from "../src/lib/idl.json" with { type: "json" };

const LAMPORTS_PER_COOK = 1_000_000_000n;
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID ?? "Dwd7DXUQHRJaj1suYz6fTcVW7JJqBFVztg1z77t6Ysg");
const RPC_URL = process.env.RPC_URL ?? "https://rpc.cookiescan.io";
const connection = new Connection(RPC_URL, "confirmed");
const coder = new BorshAccountsCoder(idl);
const safetyDiscriminator = coder.accountDiscriminator("CircleSafety");
const instructionNames = new Map(
  idl.instructions.map((instruction) => [Buffer.from(instruction.discriminator).toString("hex"), instruction.name]),
);
const relevantVolumeInstructions = new Set(["contribute", "slash_absent", "claim_turn"]);
const CACHE_MS = 60_000;
const MAX_SIGNATURES = 5_000;

/**
 * How long a single invocation may spend walking history before it gives up and
 * reports what it has. A serverless function that runs out of wall clock returns
 * nothing at all, which is strictly worse than returning a number honestly
 * labelled `complete: false`.
 */
const SCAN_BUDGET_MS = 8_000;

const DAY_SECONDS = 86_400;

let cached;

/**
 * Totals carried between invocations on a warm instance, so a busy program is
 * not re-indexed from genesis every minute. `newest` is the high-water mark:
 * later runs ask the RPC only for signatures after it.
 *
 * It advances only when a scan finished, because a partial scan leaves a hole
 * between what was read and the old mark, and a high-water mark that skips a
 * hole loses those transactions permanently. A partial run therefore reports its
 * numbers and throws its own work away rather than corrupting the ledger.
 */
let ledger = { newest: null, allTime: totals(), recent: [] };

function totals() {
  return { contribution: 0n, payout: 0n, transactions: 0 };
}

function addTo(target, event) {
  target.contribution += event.contribution;
  target.payout += event.payout;
  target.transactions += 1;
}

const seed = (name) => Buffer.from(name);
const pda = (name, circle) => PublicKey.findProgramAddressSync([seed(name), circle.toBuffer()], PROGRAM_ID)[0];
const cook = (lamports) => Number(lamports) / Number(LAMPORTS_PER_COOK);
const principal = (lamports, rent) => BigInt(Math.max(0, lamports - rent));

function stateName(state) {
  if (state?.Running) return "running";
  if (state?.Finished) return "finished";
  return "forming";
}

function decodeInstruction(data) {
  return instructionNames.get(Buffer.from(data).subarray(0, 8).toString("hex"));
}

/**
 * Signatures newer than `until`, newest first. Omitting `until` walks the whole
 * history, which is what a cold instance has to do once.
 */
async function loadSignatures(until, deadline) {
  const signatures = [];
  let before;
  while (signatures.length < MAX_SIGNATURES) {
    if (Date.now() > deadline) return { signatures, complete: false };
    const page = await connection.getSignaturesForAddress(PROGRAM_ID, {
      limit: Math.min(1_000, MAX_SIGNATURES - signatures.length),
      ...(before ? { before } : {}),
      ...(until ? { until } : {}),
    });
    signatures.push(...page);
    if (page.length < 1_000) return { signatures, complete: true };
    before = page[page.length - 1].signature;
  }
  return { signatures, complete: false };
}

function transactionKeys(message) {
  if (message.staticAccountKeys) return message.staticAccountKeys;
  return message.accountKeys.map((key) => key.pubkey ?? key);
}

/** Every pot movement a single transaction made, as plain countable events. */
function volumeEvents(tx, signatureInfo, potByAddress) {
  const events = [];
  if (!tx?.meta || signatureInfo?.err) return events;
  const message = tx.transaction.message;
  const keys = transactionKeys(message);
  const instructions = message.compiledInstructions ?? [];
  for (const instruction of instructions) {
    const programKey = keys[instruction.programIdIndex];
    if (!programKey?.equals(PROGRAM_ID)) continue;
    const name = decodeInstruction(instruction.data);
    if (!relevantVolumeInstructions.has(name)) continue;

    const circleKey = instruction.accountKeyIndexes
      .map((index) => keys[index])
      .find((key) => key && potByAddress.has(key.toBase58()));
    if (!circleKey) continue;
    const potKey = potByAddress.get(circleKey.toBase58());
    const potIndex = keys.findIndex((key) => key.equals(potKey));
    if (potIndex < 0) continue;

    const delta = BigInt(tx.meta.postBalances[potIndex]) - BigInt(tx.meta.preBalances[potIndex]);
    events.push({
      blockTime: signatureInfo.blockTime ?? 0,
      contribution: name === "claim_turn" || delta <= 0n ? 0n : delta,
      payout: name === "claim_turn" && delta < 0n ? -delta : 0n,
    });
  }
  return events;
}

async function loadVolume(potByAddress, asOf, deadline) {
  // Only signatures the ledger has not already counted. A cold instance has no
  // mark and walks everything once.
  const { signatures, complete: walked } = await loadSignatures(ledger.newest, deadline);

  const fresh = [];
  let scanned = true;
  for (let offset = 0; offset < signatures.length; offset += 100) {
    if (Date.now() > deadline) { scanned = false; break; }
    const batch = signatures.slice(offset, offset + 100);
    const transactions = await connection.getTransactions(
      batch.map((entry) => entry.signature),
      { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
    );
    transactions.forEach((tx, index) => fresh.push(...volumeEvents(tx, batch[index], potByAddress)));
  }

  const complete = walked && scanned;
  const cutoff = Math.floor(asOf / 1000) - DAY_SECONDS;

  // A partial pass is reported but not kept, so the high-water mark never jumps
  // over transactions that were never read.
  const allTime = { ...ledger.allTime };
  const recent = [...ledger.recent, ...fresh].filter((event) => event.blockTime >= cutoff);
  for (const event of fresh) addTo(allTime, event);

  if (complete) {
    ledger = {
      newest: signatures[0]?.signature ?? ledger.newest,
      allTime,
      recent,
    };
  }

  const recentTotals = totals();
  for (const event of recent) addTo(recentTotals, event);

  const serialize = (bucket) => ({
    contributionCook: cook(bucket.contribution),
    payoutCook: cook(bucket.payout),
    grossCook: cook(bucket.contribution + bucket.payout),
    transactions: bucket.transactions,
  });
  return {
    allTime: serialize(allTime),
    last24h: serialize(recentTotals),
    newSignatures: signatures.length,
    complete,
  };
}

async function buildMetrics() {
  const asOf = Date.now();
  const deadline = asOf + SCAN_BUDGET_MS;
  const circleFilter = coder.accountDiscriminator("Circle");
  const circleAccounts = await connection.getProgramAccounts(PROGRAM_ID, {
    commitment: "confirmed",
    filters: [{ memcmp: { offset: 0, bytes: anchorBase58(circleFilter) } }],
  });
  const circles = circleAccounts.map((entry) => ({
    address: entry.pubkey,
    account: coder.decode("Circle", entry.account.data),
  }));
  const safeties = await connection.getProgramAccounts(PROGRAM_ID, {
    commitment: "confirmed",
    filters: [{ memcmp: { offset: 0, bytes: anchorBase58(safetyDiscriminator) } }],
  });
  const safetyMap = new Map(safeties.map((entry) => {
    const safety = coder.decode("CircleSafety", entry.account.data);
    return [safety.circle.toBase58(), safety];
  }));
  const rent = await connection.getMinimumBalanceForRentExemption(0);
  const active = circles.filter((entry) => stateName(entry.account.state) !== "finished");
  const vaults = active.flatMap((entry) => [pda("bond", entry.address), pda("pot", entry.address)]);
  const balances = await connection.getMultipleAccountsInfo(vaults, "confirmed");
  let tvl = 0n;
  let protectedTvl = 0n;
  let bond = 0n;
  let pot = 0n;
  let protectedRooms = 0;
  for (let index = 0; index < active.length; index += 1) {
    const bondPrincipal = principal(balances[index * 2]?.lamports ?? 0, rent);
    const potPrincipal = principal(balances[index * 2 + 1]?.lamports ?? 0, rent);
    const total = bondPrincipal + potPrincipal;
    tvl += total;
    bond += bondPrincipal;
    pot += potPrincipal;
    if (safetyMap.get(active[index].address.toBase58())?.protected) {
      protectedTvl += total;
      protectedRooms += 1;
    }
  }
  // Volume is measured against EVERY circle, not just the active ones. A circle
  // that finishes does not un-happen, and scoping this to active circles made
  // all-time volume fall as rounds completed.
  const potByAddress = new Map(circles.map((entry) => [entry.address.toBase58(), pda("pot", entry.address)]));
  const volume = await loadVolume(potByAddress, asOf, deadline);
  return {
    ok: true,
    asOf: new Date(asOf).toISOString(),
    source: { network: "Cookie Chain mainnet", rpc: RPC_URL, program: PROGRAM_ID.toBase58() },
    tvl: {
      activeCook: cook(tvl), protectedCook: cook(protectedTvl), bondCook: cook(bond), potCook: cook(pot),
    },
    rooms: {
      active: active.filter((entry) => stateName(entry.account.state) === "running").length,
      // A forming circle nobody is in is not a room looking for members, it is
      // an abandoned or test account. Counting it overstates the lobby.
      forming: active.filter((entry) =>
        stateName(entry.account.state) === "forming" && entry.account.member_count > 0).length,
      protected: protectedRooms,
    },
    members: active.reduce((total, entry) => total + entry.account.member_count, 0),
    volume,
  };
}

// Keep the endpoint cheap for the app and transparent about its freshness.
function anchorBase58(bytes) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let output = "";
  while (value > 0n) { output = alphabet[Number(value % 58n)] + output; value /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; output = "1" + output; }
  return output;
}

export default async function handler(_req, res) {
  try {
    if (!cached || cached.expiresAt <= Date.now()) {
      cached = { expiresAt: Date.now() + CACHE_MS, promise: buildMetrics() };
    }
    const result = await cached.promise;
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json(result);
  } catch {
    cached = null;
    return res.status(503).json({ ok: false, error: "Metrics are temporarily unavailable. Try again shortly." });
  }
}
