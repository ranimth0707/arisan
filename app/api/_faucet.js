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

/** Leaves the faucet wallet rent-exempt and able to pay its own next fee. */
const MIN_FUNDING_BUFFER = 100_000;

/**
 * Held back when the faucet shares the relayer's wallet, so faucet spend can
 * never take the sponsor below a working fee budget. Roughly 2,000 sponsored
 * transactions at the 10,000 lamport fee Cookie Chain charges.
 *
 * This is the fallback. Setting FAUCET_SECRET_KEY to a separate, deliberately
 * small wallet is better: then the worst case is a dead faucet rather than a
 * relayer forced to defend itself.
 */
const RELAYER_RESERVE = 20 * LAMPORTS_PER_COOK;

/**
 * A wallet holding this much already has enough to join a demo circle and pay
 * several rounds, so it has nothing to gain from the faucet. This is the one
 * check a drainer cannot sidestep by rotating addresses: swept COOK has to land
 * somewhere, and every hop costs another fresh wallet.
 */
const ALREADY_FUNDED = 2 * LAMPORTS_PER_COOK;

// Request-shaped limits. Deliberately keyed on the IP and the wallet
// SEPARATELY, never on the pair: a key that includes the recipient hands out a
// fresh quota for every address, which is free to generate and therefore no
// limit at all. Serverless instances do not share memory, so treat these as
// friction that thins out bursts, not as the bound. The bound is the balance of
// a small, separate faucet wallet.
// Overridable so the adversarial suite can be run more than once in ten minutes
// without its own throttling being reported as a faucet failure.
const PER_IP = { max: Number(process.env.FAUCET_MAX_PER_IP) || 4, windowMs: 10 * 60_000 };
const PER_WALLET = { max: Number(process.env.FAUCET_MAX_PER_WALLET) || 1, windowMs: 60 * 60_000 };

export const faucetAmount = () => {
  const configured = Number(process.env.FAUCET_AMOUNT_COOK ?? DEFAULT_AMOUNT);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_AMOUNT;
  return Math.min(configured, MAX_AMOUNT);
};

/** What the faucet may spend, after any reserve it has to leave behind. */
function spendable(balance, sharedWithRelayer) {
  const reserve = (sharedWithRelayer ? RELAYER_RESERVE : 0) + MIN_FUNDING_BUFFER;
  return Math.max(0, balance - reserve);
}

export async function faucetStatus() {
  const { keypair, connection, sharedWithRelayer } = loadFaucet();
  const balanceLamports = await connection.getBalance(keypair.publicKey);
  return {
    ok: true,
    faucet: keypair.publicKey.toBase58(),
    amountCook: faucetAmount(),
    balanceLamports,
    spendableLamports: spendable(balanceLamports, sharedWithRelayer),
    sharedWithRelayer: Boolean(sharedWithRelayer),
    // Reported so a test can assert against the limit actually in force rather
    // than a number copied into it, which breaks the moment either one moves.
    perIp: PER_IP.max,
    perWallet: PER_WALLET.max,
  };
}

const fail = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

export async function dispense(wallet, clientKey = "unknown") {
  let recipient;
  try {
    recipient = new PublicKey(wallet);
  } catch {
    throw fail(400, "Enter a valid wallet address.");
  }

  const { keypair, connection, sharedWithRelayer } = loadFaucet();
  if (recipient.equals(keypair.publicKey)) {
    throw fail(400, "The faucet wallet cannot claim from itself.");
  }
  // A wallet is not a valid destination if the program owns it or it carries
  // code; the faucet funds people, not accounts.
  const recipientInfo = await connection.getAccountInfo(recipient, "confirmed");
  if (recipientInfo?.executable) {
    throw fail(400, "That address is a program, not a wallet.");
  }
  if ((recipientInfo?.lamports ?? 0) >= ALREADY_FUNDED) {
    throw fail(400, "That wallet already has enough COOK to try the demo.");
  }

  if (rateLimited(`faucet:ip:${clientKey}`, PER_IP.max, PER_IP.windowMs)) {
    throw fail(429, "Too many claims from this connection. Try again later.");
  }
  if (rateLimited(`faucet:wallet:${recipient.toBase58()}`, PER_WALLET.max, PER_WALLET.windowMs)) {
    throw fail(429, "This wallet already claimed. Try again in an hour.");
  }

  const lamports = Math.round(faucetAmount() * LAMPORTS_PER_COOK);
  const balance = await connection.getBalance(keypair.publicKey);
  if (spendable(balance, sharedWithRelayer) < lamports) {
    throw fail(503, "The demo faucet is temporarily empty. Please try again later.");
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
    throw fail(502, e?.message ?? "The faucet transaction failed.");
  }
}
