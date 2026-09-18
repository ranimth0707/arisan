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
/** How many recent transactions the rolling window will read bodies for. */
const RECENT_SIGNATURE_LIMIT = 600;

/**
 * How long a single invocation may spend walking history before it gives up and
 * reports what it has. A serverless function that runs out of wall clock returns
 * nothing at all, which is strictly worse than returning a number honestly
 * labelled `complete: false`.
 */
const SCAN_BUDGET_MS = 8_000;

const DAY_SECONDS = 86_400;

let cached;

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

/**
 * All-time volume, derived from account state rather than from history.
 *
 * Every completed round collects `contribution × member_count` into the pot and
 * pays all of it to one member, so a circle that has seen `winners_so_far`
 * rounds has moved that much in each direction, plus whatever is sitting in the
 * pot right now on the round in progress.
 *
 * This replaced a walk over the program's signatures, which was correct until
 * the program passed a few thousand transactions and the scan could no longer
 * finish inside a serverless invocation. A partial scan reported a partial
 * number, so the published all-time volume started going *down* as the app got
 * busier — the worst possible failure for a figure people are asked to trust.
 * Reading it from state is exact, always complete, and costs one RPC call
 * regardless of how much history there is.
 */
function volumeFromState(circles) {
  let contribution = 0n;
  let payout = 0n;
  let rounds = 0;
  for (const entry of circles) {
    const account = entry.account;
    const perRound = BigInt(account.contribution.toString()) * BigInt(account.member_count);
    const completed = BigInt(account.winners_so_far);
    payout += perRound * completed;
    contribution += perRound * completed + BigInt(account.pot_amount.toString());
    rounds += account.winners_so_far;
  }
  return { contribution, payout, rounds };
}

/**
 * The last day only, which does need history — but a bounded amount of it: the
 * walk stops at the first signature older than the window.
 */
async function volumeLastDay(potByAddress, asOf, deadline) {
  const cutoff = Math.floor(asOf / 1000) - DAY_SECONDS;
  const signatures = [];
  let before;
  let complete = false;

  // Bounded by a transaction count as well as by the window. Fetching bodies is
  // what costs, and on a busy day a full day is more than an invocation can
  // read — so this covers as much of the day as it can afford and reports the
  // span it actually managed, instead of a "last 24h" figure that quietly is
  // not.
  outer: while (signatures.length < RECENT_SIGNATURE_LIMIT) {
    if (Date.now() > deadline) break;
    const page = await connection.getSignaturesForAddress(PROGRAM_ID, {
      limit: Math.min(1000, RECENT_SIGNATURE_LIMIT - signatures.length),
      ...(before ? { before } : {}),
    });
    if (!page.length) { complete = true; break; }
    for (const entry of page) {
      if (entry.blockTime && entry.blockTime < cutoff) { complete = true; break outer; }
      signatures.push(entry);
    }
    before = page[page.length - 1].signature;
  }

  const totals = { contribution: 0n, payout: 0n, transactions: 0 };
  for (let offset = 0; offset < signatures.length; offset += 100) {
    if (Date.now() > deadline) { complete = false; break; }
    const batch = signatures.slice(offset, offset + 100);
    const transactions = await connection.getTransactions(
      batch.map((entry) => entry.signature),
      { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
    );
    transactions.forEach((tx, index) => {
      for (const event of volumeEvents(tx, batch[index], potByAddress)) {
        totals.contribution += event.contribution;
        totals.payout += event.payout;
        totals.transactions += 1;
      }
    });
  }
  const oldest = signatures.length ? signatures[signatures.length - 1].blockTime : null;
  return {
    totals,
    complete,
    scanned: signatures.length,
    windowSeconds: oldest ? Math.max(0, Math.floor(asOf / 1000) - oldest) : DAY_SECONDS,
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
  const allTime = volumeFromState(circles);
  const day = await volumeLastDay(potByAddress, asOf, deadline);
  const serialize = (contribution, payout, transactions) => ({
    contributionCook: cook(contribution),
    payoutCook: cook(payout),
    grossCook: cook(contribution + payout),
    ...(transactions === undefined ? {} : { transactions }),
  });
  const volume = {
    allTime: {
      ...serialize(allTime.contribution, allTime.payout),
      roundsCompleted: allTime.rounds,
      // Derived from account state, so it does not depend on how much history
      // an invocation had time to read.
      exact: true,
    },
    recent: {
      ...serialize(day.totals.contribution, day.totals.payout, day.totals.transactions),
      windowHours: Math.round((day.windowSeconds / 3600) * 10) / 10,
      coversFullDay: day.complete,
    },
    scannedSignatures: day.scanned,
  };
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
