import { PublicKey, TransactionInstruction, type VersionedTransaction } from "@solana/web3.js";

/** Permissionless cranks still need the requesting wallet in the signer list
 * when the fee payer is a relayer. Anchor accepts this as a remaining account. */
export function withRequesterSigner(
  instructions: TransactionInstruction[], requester: PublicKey, programId: PublicKey,
): TransactionInstruction[] {
  if (instructions.some(ix => ix.keys.some(key => key.isSigner && key.pubkey.equals(requester)))) return instructions;
  const index = instructions.findIndex(ix => ix.programId.equals(programId));
  if (index < 0) throw new Error("Tidak ada instruksi aplikasi untuk ditandatangani.");
  return instructions.map((ix, i) => i !== index ? ix : new TransactionInstruction({
    programId: ix.programId,
    data: ix.data,
    keys: [...ix.keys, { pubkey: requester, isSigner: true, isWritable: false }],
  }));
}

export function assertWalletSigner(tx: VersionedTransaction, owner: PublicKey) {
  const signers = tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures);
  if (!signers.some(key => key.equals(owner))) {
    throw new Error("Wallet kamu belum tercantum sebagai penanda tangan transaksi. Muat ulang aplikasi.");
  }
}
