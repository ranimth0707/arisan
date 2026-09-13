// Transaction submission with two paths.
//
// Sponsored: the relayer is the fee payer, the wallet only signs to authorise,
// and the user spends nothing. This is what lets a wallet holding zero COOK use
// the app at all.
//
// Self-paid: the wallet pays its own fee. Used when no sponsor is configured,
// when the relayer is down, or if a wallet refuses to sign a transaction it is
// not paying for. The app keeps working either way.

import {
  PublicKey, TransactionMessage, VersionedTransaction,
  type Connection, type TransactionInstruction,
} from "@solana/web3.js";
import { RELAYER_API, connection, readableError } from "./cookiejar";
import { signForCookieChain } from "./chain";

export type SendStage =
  | "building"
  | "awaiting-signature"
  | "sponsoring"
  | "broadcasting"
  | "confirming"
  | "confirmed"
  | "failed";

export interface SendProgress {
  stage: SendStage;
  signature?: string;
  detail?: string;
  sponsored?: boolean;
}

export interface WalletLike {
  publicKey: PublicKey | null;
  signTransaction?: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
  /** The adapter wrapper, so we can reach the Wallet Standard object under it. */
  wallet?: unknown;
}

/**
 * Signs, naming Cookie Chain when the wallet understands it.
 *
 * Without the chain the wallet simulates against whatever network it is
 * currently pointed at and warns that a perfectly good transaction will fail.
 * The fallback still yields a valid signature, because a signature covers the
 * transaction bytes and nothing about the chain.
 */
async function signIt(
  wallet: WalletLike,
  tx: VersionedTransaction,
): Promise<VersionedTransaction> {
  if (wallet.publicKey) {
    const signed = await signForCookieChain(
      wallet.wallet,
      wallet.publicKey,
      tx,
      (bytes) => VersionedTransaction.deserialize(bytes),
    );
    if (signed) return signed;
  }
  return wallet.signTransaction!(tx);
}

/**
 * Instructions are built lazily because the account that pays account rent
 * differs between the two paths: the relayer when sponsored, the user when not.
 * Building eagerly would leave a stale relayer signer in the fallback and make
 * the transaction unsignable.
 */
export type InstructionBuilder =
  (payer: PublicKey) => Promise<TransactionInstruction[]>;

interface SendOptions {
  build: InstructionBuilder;
  /** Prepended reimbursement instruction. Its presence means "try sponsored". */
  reimbursement?: TransactionInstruction;
  relayerPubkey?: PublicKey;
  onProgress?: (p: SendProgress) => void;
  conn?: Connection;
}

let cachedRelayer: { pubkey: PublicKey; ok: boolean } | null = null;

/** Asks the relayer who it is. Cached, since it never changes at runtime. */
export async function getRelayerInfo(): Promise<PublicKey | null> {
  if (cachedRelayer) return cachedRelayer.ok ? cachedRelayer.pubkey : null;
  try {
    const res = await fetch(`${RELAYER_API}/health`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error("relayer unhealthy");
    const body = await res.json();
    const pubkey = new PublicKey(body.relayer);
    cachedRelayer = { pubkey, ok: true };
    return pubkey;
  } catch {
    cachedRelayer = { pubkey: PublicKey.default, ok: false };
    return null;
  }
}

export async function send(
  wallet: WalletLike,
  opts: SendOptions,
): Promise<{ signature: string; sponsored: boolean }> {
  const conn = opts.conn ?? connection;
  const report = opts.onProgress ?? (() => {});

  if (!wallet.publicKey) throw new Error("Connect a wallet first.");
  if (!wallet.signTransaction) throw new Error("This wallet cannot sign transactions.");

  report({ stage: "building" });

  const canSponsor = Boolean(opts.reimbursement && opts.relayerPubkey);

  if (canSponsor) {
    try {
      return await sendSponsored(wallet, opts, conn, report);
    } catch (e) {
      // A wallet that refuses to sign for someone else's fee, or a relayer that
      // is down, should degrade rather than dead-end. Only a deliberate user
      // cancellation stops here.
      const message = readableError(e);
      if (message.startsWith("You cancelled")) throw e;
      report({ stage: "building", detail: `Sponsored path unavailable (${message}). Paying your own fee.` });
    }
  }

  return await sendSelfPaid(wallet, opts, conn, report);
}

async function sendSponsored(
  wallet: WalletLike,
  opts: SendOptions,
  conn: Connection,
  report: (p: SendProgress) => void,
) {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();

  const instructions = await opts.build(opts.relayerPubkey!);

  const message = new TransactionMessage({
    payerKey: opts.relayerPubkey!, // relayer pays every lamport of fee
    recentBlockhash: blockhash,
    instructions: [opts.reimbursement!, ...instructions],
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);

  report({ stage: "awaiting-signature", sponsored: true });
  const signed = await signIt(wallet, tx);

  report({ stage: "sponsoring", sponsored: true });
  const res = await fetch(`${RELAYER_API}/sponsor`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transaction: Buffer.from(signed.serialize()).toString("base64"),
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "The relayer refused this transaction.");

  report({ stage: "confirming", signature: body.signature, sponsored: true });
  const confirmation = await conn.confirmTransaction(
    { signature: body.signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );

  if (confirmation.value.err) throw new Error("Transaksi gagal di blockchain: " + JSON.stringify(confirmation.value.err));

  report({ stage: "confirmed", signature: body.signature, sponsored: true });
  return { signature: body.signature as string, sponsored: true };
}

async function sendSelfPaid(
  wallet: WalletLike,
  opts: SendOptions,
  conn: Connection,
  report: (p: SendProgress) => void,
) {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();

  const instructions = await opts.build(wallet.publicKey!);

  const message = new TransactionMessage({
    payerKey: wallet.publicKey!,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);

  report({ stage: "awaiting-signature", sponsored: false });
  const signed = await signIt(wallet, tx);

  report({ stage: "broadcasting", sponsored: false });
  const signature = await conn.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });

  report({ stage: "confirming", signature, sponsored: false });
  const confirmation = await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  if (confirmation.value.err) throw new Error("Transaksi gagal di blockchain: " + JSON.stringify(confirmation.value.err));

  report({ stage: "confirmed", signature, sponsored: false });
  return { signature, sponsored: false };
}

export const stageLabel: Record<SendStage, string> = {
  building: "Menyiapkan transaksi",
  "awaiting-signature": "Periksa dan setujui di wallet",
  sponsoring: "Sponsor memproses biaya",
  broadcasting: "Mengirim ke Cookie Chain",
  confirming: "Menunggu konfirmasi",
  confirmed: "Transaksi berhasil",
  failed: "Transaksi belum berhasil",
};
