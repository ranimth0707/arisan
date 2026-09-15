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
// Run in your own terminal. Piping is the easiest way, because there is no
// environment variable left behind to lose or to leak:
//
//   zerion wallet export-key --wallet zns-01 --chain solana \
//     | node scripts/fund-treasury.mjs 14000
//
// Or with an environment variable, if you prefer:
//
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
import readline from "node:readline";

const RPC = "https://rpc.cookiescan.io";
const LAMPORTS_PER_COOK = 1_000_000_000;
const TREASURY_FILE = path.join(os.homedir(), ".config/solana/cookiejar-treasury.json");

const amountCook = Number(process.argv[2]);
if (!Number.isFinite(amountCook) || amountCook <= 0) {
  console.error("usage: node scripts/fund-treasury.mjs <amountCOOK>");
  process.exit(1);
}

/** Reads piped stdin, or nothing at all when the script is run interactively. */
async function readPipedInput() {
  if (process.stdin.isTTY) return "";
  let text = "";
  for await (const chunk of process.stdin) {
    text += chunk;
    if (text.length > 64_000) break;
  }
  return text;
}

/**
 * Asks for the key on the terminal without echoing it.
 *
 * Some wallet CLIs write an exported key straight to the terminal rather than
 * to stdout, precisely so it cannot be captured by a pipe or a `$(...)`. That is
 * a sensible thing for them to do, and it means the only way to hand the key
 * over is to paste it. Not echoing keeps it out of the scrollback, and reading
 * it here keeps it out of shell history and out of the environment.
 */
function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin, output: process.stdout, terminal: true,
    });
    process.stdout.write(question);
    rl._writeToOutput = () => {};
    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

let raw = (await readPipedInput()) || process.env.SOLANA_PRIVATE_KEY || "";

if (!raw.trim() && process.stdin.isTTY) {
  console.log("Paste the zns-01 Solana private key. It will not be shown.");
  console.log("Get it with: zerion wallet export-key --wallet zns-01 --chain solana");
  console.log("Wipe your scrollback afterwards, since that command prints it.\n");
  raw = await promptHidden("private key: ");
}

if (!raw.trim()) {
  console.error("No private key given. Run this in a terminal so it can prompt,");
  console.error("or set SOLANA_PRIVATE_KEY in your own shell first.");
  process.exit(1);
}

/**
 * Accepts whatever the wallet hands over: a base58 key, the JSON byte array
 * solana-keygen writes, or a JSON object from a CLI that reports its results
 * structurally. Guessing here is friendlier than making the caller reshape a
 * secret on the command line, where it would end up in shell history.
 */
function loadKeypair(input) {
  const text = input.trim();

  if (text.startsWith("[")) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(text)));
  }

  if (text.startsWith("{")) {
    const parsed = JSON.parse(text);
    const candidate = parsed.solana ?? parsed.privateKey ?? parsed.secretKey
      ?? parsed.key ?? parsed.solanaPrivateKey ?? parsed.sol;
    const value = typeof candidate === "object" && candidate !== null
      ? (candidate.privateKey ?? candidate.secretKey ?? candidate.key)
      : candidate;
    if (!value) {
      throw new Error(
        `could not find a private key in that JSON (keys: ${Object.keys(parsed).join(", ")})`,
      );
    }
    return loadKeypair(String(value));
  }

  // A single trailing newline is normal; anything else suggests the prompt or a
  // log line got captured along with the key.
  if (/\s/.test(text)) {
    throw new Error("the input has spaces or line breaks in it, so it is not just a key");
  }
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

let payer;
try {
  payer = loadKeypair(raw);
} catch (e) {
  console.error(`Could not read that as a private key: ${e.message}`);
  // Deliberately not suggesting a command that prints key material: the shape
  // is enough to diagnose this, and the contents would land in shell history.
  console.error("To see the shape without revealing it:");
  console.error("  zerion wallet export-key --wallet zns-01 --chain solana | cut -c1-1");
  console.error("  '{' means JSON; anything else should be a bare base58 key.");
  process.exit(1);
}

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
