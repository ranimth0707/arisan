import {
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import { loadFaucet, rateLimited } from "./_relayer.js";

const LAMPORTS_PER_COOK = 1_000_000_000;
const DEFAULT_AMOUNT = 0.5;
const MAX_AMOUNT = 1;
const MIN_FUNDING_BUFFER = 100_000;

export const faucetAmount = () => {
  const configured = Number(process.env.FAUCET_AMOUNT_COOK ?? DEFAULT_AMOUNT);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_AMOUNT;
  return Math.min(configured, MAX_AMOUNT);
};

export async function faucetStatus() {
  const { keypair, connection } = loadFaucet();
  return {
    ok: true,
    faucet: keypair.publicKey.toBase58(),
    amountCook: faucetAmount(),
    balanceLamports: await connection.getBalance(keypair.publicKey),
  };
}

export async function dispense(wallet, clientKey = "unknown") {
  let recipient;
  try {
    recipient = new PublicKey(wallet);
  } catch {
    const error = new Error("Enter a valid wallet address.");
    error.status = 400;
    throw error;
  }

  const { keypair, connection } = loadFaucet();
  if (recipient.equals(keypair.publicKey)) {
    const error = new Error("The faucet wallet cannot claim from itself.");
    error.status = 400;
    throw error;
  }

  // This is intentionally best-effort in serverless memory. The fixed amount,
  // IP+wallet keys and a separate faucet wallet make abuse bounded even when a
  // Vercel instance is replaced.
  if (rateLimited(`faucet:${clientKey}:${recipient.toBase58()}`)) {
    const error = new Error("You already claimed recently. Try again in a minute.");
    error.status = 429;
    throw error;
  }

  const lamports = Math.round(faucetAmount() * LAMPORTS_PER_COOK);
  const balance = await connection.getBalance(keypair.publicKey);
  if (balance < lamports + MIN_FUNDING_BUFFER) {
    const error = new Error("The demo faucet is temporarily empty. Please try again later.");
    error.status = 503;
    throw error;
  }

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const message = new TransactionMessage({
    payerKey: keypair.publicKey,
    recentBlockhash: blockhash,
    instructions: [SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: recipient,
      lamports,
    })],
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  transaction.sign([keypair]);

  try {
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    return { signature, amountLamports: lamports, amountCook: lamports / LAMPORTS_PER_COOK };
  } catch (e) {
    const error = new Error(e?.message ?? "The faucet transaction failed.");
    error.status = 502;
    throw error;
  }
}
