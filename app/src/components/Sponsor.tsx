import { useCallback, useEffect, useState } from "react";
import { PublicKey, SystemProgram } from "@solana/web3.js";

import {
  bn, connection, findSponsor, findSponsorVault, formatCook, formatCount,
  readableError, toLamports, type CookieJarProgram,
} from "../lib/cookiejar";
import { SPONSOR_AUTHORITY, type RentKind } from "../hooks/useCookieJar";
import type { InstructionBuilder } from "../lib/send";

interface Props {
  program: CookieJarProgram;
  owner: PublicKey | null;
  submit: (
    build: InstructionBuilder,
    rent?: RentKind,
    instruction?: string,
  ) => Promise<{ signature: string; sponsored: boolean }>;
  onChanged: () => void;
}

/**
 * Gas sponsorship, the part that lets an empty wallet do anything at all.
 *
 * Each sponsor funds its own vault rather than a shared pool, so no project can
 * spend another's budget. The relayer can only ever reclaim what it actually
 * fronted, capped per transaction by the program.
 */
export function Sponsor({ program, owner, submit, onChanged }: Props) {
  const [amount, setAmount] = useState("10");
  const [mine, setMine] = useState<{ balance: number; spent: number; count: number } | null>(null);
  const [publicTank, setPublicTank] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setPublicTank(await connection.getBalance(findSponsorVault(SPONSOR_AUTHORITY)));
    if (!owner) { setMine(null); return; }
    try {
      const account = await program.account.sponsor.fetch(findSponsor(owner));
      setMine({
        balance: await connection.getBalance(findSponsorVault(owner)),
        spent: account.totalSpent.toNumber(),
        count: account.txSponsored.toNumber(),
      });
    } catch {
      setMine(null);
    }
  }, [program, owner]);

  useEffect(() => { void refresh(); }, [refresh]);

  const run = async (kind: "deposit" | "withdraw") => {
    if (!owner) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setErr("Enter an amount first.");
      return;
    }
    setErr(null);
    setBusy(kind);
    try {
      await submit(async () => [
        kind === "deposit"
          ? await program.methods.depositGas(bn(toLamports(value))).accountsPartial({
              authority: owner,
              sponsor: findSponsor(owner),
              sponsorVault: findSponsorVault(owner),
              systemProgram: SystemProgram.programId,
            }).instruction()
          : await program.methods.withdrawGas(bn(toLamports(value))).accountsPartial({
              authority: owner,
              sponsor: findSponsor(owner),
              sponsorVault: findSponsorVault(owner),
              systemProgram: SystemProgram.programId,
            }).instruction(),
      ], "none", kind === "deposit" ? "depositGas" : "withdrawGas");
      await refresh();
      onChanged();
    } catch (e) {
      setErr(readableError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <strong>Who pays for gas</strong>
        <p className="muted" style={{ marginTop: 4 }}>
          On Cookie Chain a new wallet is stuck before it starts, because every
          action needs COOK it does not have. A sponsor vault covers that fee so
          somebody with an empty wallet can still open a cookie.
        </p>

        {publicTank !== null && (
          <div className="banner info">
            The public tank holds {formatCook(publicTank)} COOK, good for at
            least {formatCount(Math.floor(publicTank / 5_000_000))} more free
            claims. Anyone can use it.
          </div>
        )}

        <p className="muted">
          Running your own project on Cookie Chain? Fund your own vault below and
          point a deployment at it. Nobody else can spend your budget, and you
          can pull back whatever is left at any time.
        </p>
      </div>

      <div className="card">
        <strong>Your gas vault</strong>

        {err && <div className="banner warn">{err}</div>}

        {mine ? (
          <div className="row" style={{ gap: 24, margin: "14px 0" }}>
            <div className="stat">available<b>{formatCook(mine.balance)}</b></div>
            <div className="stat">spent so far<b>{formatCook(mine.spent)}</b></div>
            <div className="stat">transactions paid<b>{formatCount(mine.count)}</b></div>
          </div>
        ) : (
          <p className="muted" style={{ marginTop: 8 }}>
            {owner ? "You have not opened a gas vault yet." : "Connect a wallet to open one."}
          </p>
        )}

        {owner && (
          <div className="row" style={{ marginTop: 8 }}>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="COOK"
              style={{ flex: 1, minWidth: 110 }}
            />
            <button className="primary" disabled={busy !== null} onClick={() => run("deposit")}>
              {busy === "deposit" ? "..." : "Add gas"}
            </button>
            <button
              className="ghost"
              disabled={busy !== null || !mine || mine.balance === 0}
              onClick={() => run("withdraw")}
            >
              {busy === "withdraw" ? "..." : "Take back"}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
