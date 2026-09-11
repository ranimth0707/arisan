import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";

import {
  bn, connection, findConfig, findSponsor, findSponsorVault, getProgram,
  getReadOnlyProgram, readableError, type CookieJarProgram,
} from "../lib/cookiejar";
import { getRelayerInfo, send, type InstructionBuilder, type SendProgress } from "../lib/send";

/**
 * Whose gas budget pays for anonymous users. Defaults to the protocol's own
 * sponsor account; any app can register its own and point a deployment at it.
 */
export const SPONSOR_AUTHORITY = new PublicKey(
  import.meta.env.VITE_SPONSOR ?? "7zSgKrxUG28Bm3V7zMAPRHfUGiBvV3gFg4iqKqR93qeh",
);

/** Account sizes the program allocates, used to size a reimbursement exactly. */
const SIZES = { claim: 8 + 90, position: 8 + 130 };
const FEE_HEADROOM = 20_000;

let rentCache: Promise<{ claim: number; position: number }> | null = null;
function rents() {
  rentCache ??= (async () => ({
    claim: await connection.getMinimumBalanceForRentExemption(SIZES.claim),
    position: await connection.getMinimumBalanceForRentExemption(SIZES.position),
  }))();
  return rentCache;
}

export type RentKind = "claim" | "position" | "claim+position" | "none";

export function useCookieJar() {
  const wallet = useWallet();
  const [relayer, setRelayer] = useState<PublicKey | null>(null);
  const [relayerChecked, setRelayerChecked] = useState(false);
  const [progress, setProgress] = useState<SendProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getRelayerInfo().then((r) => {
      setRelayer(r);
      setRelayerChecked(true);
    });
  }, []);

  const program: CookieJarProgram = useMemo(() => {
    if (wallet.publicKey && wallet.signTransaction) {
      return getProgram(wallet as never);
    }
    return getReadOnlyProgram();
  }, [wallet.publicKey, wallet.signTransaction]);

  /** Builds the capped reimbursement that pays the relayer back on-chain. */
  const buildReimbursement = useCallback(
    async (kind: RentKind): Promise<TransactionInstruction | undefined> => {
      if (!relayer) return undefined;
      const r = await rents();
      const rent =
        kind === "claim" ? r.claim
        : kind === "position" ? r.position
        : kind === "claim+position" ? r.claim + r.position
        : 0;

      return await program.methods
        .reimburseRelayer(bn(rent + FEE_HEADROOM))
        .accountsPartial({
          relayer,
          config: findConfig(),
          sponsor: findSponsor(SPONSOR_AUTHORITY),
          sponsorVault: findSponsorVault(SPONSOR_AUTHORITY),
          systemProgram: SystemProgram.programId,
        })
        .instruction();
    },
    [program, relayer],
  );

  /**
   * Submits instructions, preferring the sponsored path and falling back to a
   * self-paid one. Progress is surfaced so the UI can narrate each step.
   *
   * `build` receives whichever account is footing the rent on the path that
   * ends up being used, so callers never have to guess.
   */
  const submit = useCallback(
    async (build: InstructionBuilder, rentKind: RentKind = "none") => {
      setError(null);
      try {
        const reimbursement = await buildReimbursement(rentKind);
        const result = await send(wallet as never, {
          build,
          reimbursement,
          relayerPubkey: relayer ?? undefined,
          onProgress: setProgress,
        });
        setTimeout(() => setProgress(null), 6000);
        return result;
      } catch (e) {
        const message = readableError(e);
        setProgress({ stage: "failed", detail: message });
        setError(message);
        setTimeout(() => setProgress(null), 8000);
        throw e;
      }
    },
    [wallet, relayer, buildReimbursement],
  );

  return {
    wallet,
    program,
    relayer,
    relayerChecked,
    sponsored: Boolean(relayer),
    progress,
    error,
    clearError: () => setError(null),
    submit,
  };
}
