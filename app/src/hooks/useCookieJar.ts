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

/**
 * Exactly what the program allocates: `8 + INIT_SPACE`, which Anchor already
 * resolves to these totals. Adding 8 again here double-counted the discriminator
 * and had the sponsor vault over-paying the relayer by 121,360 lamports on every
 * claim. Verified against the real accounts on chain.
 */
const SIZES = {
  claim: 90, position: 130, donation: 90, campaign: 464, circle: 165,
  circleRoom: 593, member: 99,
};

/**
 * A sponsored transaction carries exactly two signatures, the relayer and the
 * user, at 5,000 lamports each. Reimbursing rent plus this leaves the relayer
 * exactly whole rather than quietly accumulating from the sponsor.
 */
const FEE_HEADROOM = 10_000;

let rentCache: Promise<{
  claim: number; position: number; donation: number; campaign: number;
  circle: number; circleRoom: number; member: number;
}> | null = null;
function rents() {
  rentCache ??= (async () => ({
    claim: await connection.getMinimumBalanceForRentExemption(SIZES.claim),
    position: await connection.getMinimumBalanceForRentExemption(SIZES.position),
    donation: await connection.getMinimumBalanceForRentExemption(SIZES.donation),
    campaign: await connection.getMinimumBalanceForRentExemption(SIZES.campaign),
    circle: await connection.getMinimumBalanceForRentExemption(SIZES.circle),
    circleRoom: await connection.getMinimumBalanceForRentExemption(SIZES.circleRoom),
    member: await connection.getMinimumBalanceForRentExemption(SIZES.member),
  }))();
  return rentCache;
}

export type RentKind =
  | "claim" | "position" | "claim+position"
  | "donation" | "campaign"
  | "circle" | "circle+room" | "circleRoom" | "member" | "none";

/**
 * Mirrors SPONSORABLE in app/api/_relayer.js.
 *
 * Attempting a sponsored transaction the relayer will refuse is not harmless:
 * the wallet is asked to sign it first, simulates it, shows the user a failure
 * popup, and then has to ask for a second signature on the self-paid version.
 * Checking here means the user is only ever asked once.
 */
const SPONSORABLE = new Set([
  "crack", "crackIntoJar", "deposit", "withdraw", "harvest",
  "claimPrize", "requestDraw", "finalizeDraw", "redraw",
  "fundJar", "sweepEnvelope",
  "createCampaign", "donate", "withdrawToJar", "withdrawRaised",
  "closeCampaign",
  // Room creation rent exceeds the sponsor cap; quote and pay it from the
  // creator's wallet instead of prompting for a guaranteed-to-fail signature.
  "joinCircle", "leaveCircle", "startCircle", "contribute",
  "slashAbsent", "topUpBond", "requestTurn", "finalizeTurn", "claimTurn",
  "redrawTurn", "withdrawBond",
]);

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
        : kind === "donation" ? r.donation
        : kind === "campaign" ? r.campaign
        : kind === "circle" ? r.circle
        : kind === "circle+room" ? r.circle + r.circleRoom
        : kind === "circleRoom" ? r.circleRoom
        : kind === "member" ? r.member
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
    async (
      build: InstructionBuilder,
      rentKind: RentKind = "none",
      instruction?: string,
    ) => {
      setError(null);
      try {
        const canSponsor = instruction !== undefined && SPONSORABLE.has(instruction);
        const reimbursement = canSponsor ? await buildReimbursement(rentKind) : undefined;
        const result = await send(
          {
            publicKey: wallet.publicKey,
            signTransaction: wallet.signTransaction,
            wallet: wallet.wallet,
          } as never,
          {
            build,
            reimbursement,
            relayerPubkey: relayer ?? undefined,
            onProgress: setProgress,
          },
        );
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
