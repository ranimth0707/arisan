// Telling the wallet which chain it is signing for.
//
// The wallet-adapter `signTransaction` helper does not forward a chain, so a
// wallet falls back to whatever network the user happens to have selected. On a
// fork like Cookie Chain that means Nightly simulates against Solana, or Fogo,
// or wherever it was last pointed, reports "AccountNotFound" because this
// program does not exist there, and shows the user a red failure warning on a
// transaction that is actually fine.
//
// The Wallet Standard does carry a chain identifier. Reaching past the adapter
// to the underlying standard wallet lets us name Cookie Chain explicitly, so
// the wallet simulates against the right RPC and quotes the fee in COOK.

import type { PublicKey, VersionedTransaction } from "@solana/web3.js";

/** Cookie Chain mainnet, from `getGenesisHash`. */
export const GENESIS_HASH = "9wDaBRDgArEUpvhHxGguNkwozsZh4UpGZB9o2EoEcBB2";
export const RPC_URL = "https://rpc.cookiescan.io";
export const EXPLORER = "https://cookiescan.io";

/** CAIP-2 form: `solana:` plus the first 32 characters of the genesis hash. */
export const CHAIN_ID = `solana:${GENESIS_HASH.slice(0, 32)}`;

interface StandardAccount {
  address: string;
  publicKey: Uint8Array;
  chains: readonly string[];
}

interface SignTransactionFeature {
  signTransaction(input: {
    account: StandardAccount;
    transaction: Uint8Array;
    chain?: string;
  }): Promise<Array<{ signedTransaction: Uint8Array }>>;
}

interface StandardWallet {
  name: string;
  accounts: readonly StandardAccount[];
  chains: readonly string[];
  features: Record<string, unknown>;
}

/** Digs the Wallet Standard object out of whatever the adapter wrapped. */
function standardWallet(walletLike: unknown): StandardWallet | null {
  const adapter = (walletLike as { adapter?: { wallet?: unknown } })?.adapter;
  const inner = adapter?.wallet ?? (walletLike as { wallet?: unknown })?.wallet;
  const candidate = inner as StandardWallet | undefined;
  return candidate?.features && candidate?.accounts ? candidate : null;
}

/**
 * What the connected wallet says it can do. Used to explain the situation
 * rather than let the user stare at a scary simulation error.
 */
export interface ChainSupport {
  walletName: string | null;
  chains: readonly string[];
  /** The wallet declares Cookie Chain and we can name it when signing. */
  knowsCookieChain: boolean;
}

export function inspectWallet(walletLike: unknown, owner: PublicKey | null): ChainSupport {
  const wallet = standardWallet(walletLike);
  if (!wallet) return { walletName: null, chains: [], knowsCookieChain: false };

  const account = owner
    ? wallet.accounts.find((a) => a.address === owner.toBase58())
    : wallet.accounts[0];

  const chains = account?.chains ?? wallet.chains ?? [];
  return {
    walletName: wallet.name ?? null,
    chains,
    knowsCookieChain: chains.includes(CHAIN_ID),
  };
}

/**
 * Signs while naming Cookie Chain, when the wallet understands it.
 *
 * Returns null when that is not possible, so the caller can fall back to the
 * adapter's own signTransaction. A signature is over the transaction bytes and
 * is chain-agnostic, so the fallback still produces a valid signature. The user
 * just has to look past a simulation warning to give it.
 */
export async function signForCookieChain(
  walletLike: unknown,
  owner: PublicKey,
  tx: VersionedTransaction,
  deserialize: (bytes: Uint8Array) => VersionedTransaction,
): Promise<VersionedTransaction | null> {
  const wallet = standardWallet(walletLike);
  if (!wallet) return null;

  const feature = wallet.features["solana:signTransaction"] as SignTransactionFeature | undefined;
  if (!feature?.signTransaction) return null;

  const account = wallet.accounts.find((a) => a.address === owner.toBase58());
  if (!account) return null;
  if (!account.chains?.includes(CHAIN_ID)) return null;

  const [result] = await feature.signTransaction({
    account,
    transaction: tx.serialize(),
    chain: CHAIN_ID,
  });

  return result?.signedTransaction ? deserialize(result.signedTransaction) : null;
}
