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

async function loadSignatures() {
  const signatures = [];
  let before;
  while (signatures.length < MAX_SIGNATURES) {
    const page = await connection.getSignaturesForAddress(PROGRAM_ID, {
      limit: Math.min(1_000, MAX_SIGNATURES - signatures.length),
      ...(before ? { before } : {}),
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

function addVolume(volume, tx, signatureInfo, circleByAddress, potByAddress) {
  if (!tx?.meta || signatureInfo?.err) return;
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
      .find((key) => key && circleByAddress.has(key.toBase58()));
    if (!circleKey) continue;
    const potKey = potByAddress.get(circleKey.toBase58());
    const potIndex = potKey ? keys.findIndex((key) => key.equals(potKey)) : -1;
    if (potIndex < 0) continue;

    const delta = BigInt(tx.meta.postBalances[potIndex]) - BigInt(tx.meta.preBalances[potIndex]);
    const inflow = delta > 0n ? delta : 0n;
    const outflow = delta < 0n ? -delta : 0n;
    const bucket = signatureInfo.blockTime && signatureInfo.blockTime >= volume.cutoff ? volume.recent : volume.all;
    if (name === "claim_turn") bucket.payout += outflow;
    else bucket.contribution += inflow;
    bucket.transactions += 1;
  }
}

async function loadVolume(circleEntries, asOf) {
  const circleByAddress = new Map(circleEntries.map((entry) => [entry.address.toBase58(), entry]));
  const potByAddress = new Map(circleEntries.map((entry) => [entry.address.toBase58(), pda("pot", entry.address)]));
  const { signatures, complete } = await loadSignatures();
  const volume = {
    cutoff: Math.floor(asOf / 1000) - 86_400,
    all: { contribution: 0n, payout: 0n, transactions: 0 },
    recent: { contribution: 0n, payout: 0n, transactions: 0 },
  };

  for (let offset = 0; offset < signatures.length; offset += 100) {
    const batch = signatures.slice(offset, offset + 100);
    const transactions = await connection.getTransactions(
      batch.map((entry) => entry.signature),
      { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
    );
    transactions.forEach((tx, index) => addVolume(volume, tx, batch[index], circleByAddress, potByAddress));
  }

  const serialize = (bucket) => ({
    contributionCook: cook(bucket.contribution),
    payoutCook: cook(bucket.payout),
    grossCook: cook(bucket.contribution + bucket.payout),
    transactions: bucket.transactions,
  });
  return { allTime: serialize(volume.all), last24h: serialize(volume.recent), indexedSignatures: signatures.length, complete };
}

async function buildMetrics() {
  const asOf = Date.now();
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
  const circleEntries = active.map((entry) => ({ address: entry.address }));
  const volume = await loadVolume(circleEntries, asOf);
  return {
    ok: true,
    asOf: new Date(asOf).toISOString(),
    source: { network: "Cookie Chain mainnet", rpc: RPC_URL, program: PROGRAM_ID.toBase58() },
    tvl: {
      activeCook: cook(tvl), protectedCook: cook(protectedTvl), bondCook: cook(bond), potCook: cook(pot),
    },
    rooms: { active: active.filter((entry) => stateName(entry.account.state) === "running").length, forming: active.filter((entry) => stateName(entry.account.state) === "forming").length, protected: protectedRooms },
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
    return res.status(503).json({ ok: false, error: "Metrics sementara tidak tersedia. Coba lagi sebentar." });
  }
}
