// Sends COOK on Cookie Chain from your own wallet to the program deployer.
//
// Your key is read from the environment, used to sign locally, and never sent
// anywhere. Only the signed transaction bytes are broadcast.
//
// Run in your own terminal:
//   export SOLANA_PRIVATE_KEY="$(zerion wallet export-key --wallet zns-01 --chain solana)"
//   node scripts/fund-deployer.mjs 2000
//   unset SOLANA_PRIVATE_KEY

import {
  Connection, Keypair, PublicKey, SystemProgram,
  TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";

const RPC = "https://rpc.cookiescan.io";
const DEPLOYER = new PublicKey("7zSgKrxUG28Bm3V7zMAPRHfUGiBvV3gFg4iqKqR93qeh");
const LAMPORTS_PER_COOK = 1_000_000_000;

const amountCook = Number(process.argv[2]);
if (!Number.isFinite(amountCook) || amountCook <= 0) {
  console.error("usage: node scripts/fund-deployer.mjs <amountCOOK>");
  process.exit(1);
}

const raw = process.env.SOLANA_PRIVATE_KEY;
if (!raw) {
  console.error("set SOLANA_PRIVATE_KEY in your own shell first");
  process.exit(1);
}

// Accepts either base58 or the JSON byte array that solana-keygen writes.
function loadKeypair(input) {
  const text = input.trim();
  if (text.startsWith("[")) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(text)));
  }
  return Keypair.fromSecretKey(bs58.decode(text));
}

const payer = loadKeypair(raw);
const connection = new Connection(RPC, "confirmed");

const before = await connection.getBalance(payer.publicKey);
console.log("from:   ", payer.publicKey.toBase58());
console.log("balance:", (before / LAMPORTS_PER_COOK).toLocaleString(), "COOK");
console.log("to:     ", DEPLOYER.toBase58());
console.log("sending:", amountCook.toLocaleString(), "COOK");

const lamports = Math.round(amountCook * LAMPORTS_PER_COOK);
if (lamports >= before) {
  console.error("not enough COOK, leave some for fees");
  process.exit(1);
}

const { blockhash } = await connection.getLatestBlockhash();
const msg = new TransactionMessage({
  payerKey: payer.publicKey,
  recentBlockhash: blockhash,
  instructions: [
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: DEPLOYER,
      lamports,
    }),
  ],
}).compileToV0Message();

const tx = new VersionedTransaction(msg);
tx.sign([payer]);

const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
console.log("submitted:", sig);
await connection.confirmTransaction(sig, "confirmed");

const after = await connection.getBalance(DEPLOYER);
console.log("\ndeployer balance now:", (after / LAMPORTS_PER_COOK).toLocaleString(), "COOK");
console.log("explorer:", `https://cookiescan.io/tx/${sig}`);
