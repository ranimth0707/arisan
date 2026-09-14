// Sends COOK from your own wallet to the seeding treasury.
//
// This is the only step that needs your key. Everything after it — creating
// circles, funding members, joining, contributing, drawing — runs from the
// treasury and the member keys, which live outside this repository in
// ~/.config/solana/.
//
// Your key is read from the environment, used to sign locally, and never sent
// anywhere. Only the signed transaction bytes are broadcast.
//
// Run in your own terminal:
//   export SOLANA_PRIVATE_KEY="$(zerion wallet export-key --wallet zns-01 --chain solana)"
//   node scripts/fund-treasury.mjs 14000
//   unset SOLANA_PRIVATE_KEY

import {
  Connection, Keypair, SystemProgram,
  TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const RPC = "https://rpc.cookiescan.io";
const LAMPORTS_PER_COOK = 1_000_000_000;
const TREASURY_FILE = path.join(os.homedir(), ".config/solana/cookiejar-treasury.json");

const amountCook = Number(process.argv[2]);
if (!Number.isFinite(amountCook) || amountCook <= 0) {
  console.error("usage: node scripts/fund-treasury.mjs <amountCOOK>");
  process.exit(1);
}

const raw = process.env.SOLANA_PRIVATE_KEY;
if (!raw) {
  console.error("set SOLANA_PRIVATE_KEY in your own shell first");
  process.exit(1);
}

/** Accepts either base58 or the JSON byte array that solana-keygen writes. */
function loadKeypair(input) {
  const text = input.trim();
  if (text.startsWith("[")) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(text)));
  return Keypair.fromSecretKey(bs58.decode(text));
}

if (!fs.existsSync(TREASURY_FILE)) {
  console.error(`no treasury keypair at ${TREASURY_FILE}`);
  console.error("create one first: solana-keygen new --silent --no-bip39-passphrase -o " + TREASURY_FILE);
  process.exit(1);
}

const treasury = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(TREASURY_FILE, "utf8"))),
);

const payer = loadKeypair(raw);
const connection = new Connection(RPC, "confirmed");

const before = await connection.getBalance(payer.publicKey);
console.log("from:    ", payer.publicKey.toBase58());
console.log("balance: ", (before / LAMPORTS_PER_COOK).toLocaleString("en-US"), "COOK");
console.log("to:      ", treasury.publicKey.toBase58(), "(treasury)");
console.log("sending: ", amountCook.toLocaleString("en-US"), "COOK");

const lamports = Math.round(amountCook * LAMPORTS_PER_COOK);
if (lamports >= before) {
  console.error("not enough COOK, leave some for fees");
  process.exit(1);
}

const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
const message = new TransactionMessage({
  payerKey: payer.publicKey,
  recentBlockhash: blockhash,
  instructions: [SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: treasury.publicKey,
    lamports,
  })],
}).compileToV0Message();

const tx = new VersionedTransaction(message);
tx.sign([payer]);

const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");

const after = await connection.getBalance(treasury.publicKey);
console.log("\ntreasury balance now:", (after / LAMPORTS_PER_COOK).toLocaleString("en-US"), "COOK");
console.log("explorer:", `https://cookiescan.io/tx/${signature}`);
console.log("\nnext: node scripts/seed-circles.mjs --dry-run");
