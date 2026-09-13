import { useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";

import { connection, formatCook, readableError, txUrl } from "../lib/cookiejar";

interface Props {
  owner: PublicKey | null;
  onChanged: () => void;
}

interface FaucetStatus {
  amountCook: number;
  balanceLamports: number;
}

/** A small, rate-limited COOK tap for trying the live app with a new wallet. */
export function Faucet({ owner, onChanged }: Props) {
  const [status, setStatus] = useState<FaucetStatus | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/faucet", { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error("The faucet is offline right now.");
      setStatus(await res.json() as FaucetStatus);
    } catch (e) {
      setStatus(null);
      setErr(readableError(e));
    }
    if (owner) {
      try { setBalance(await connection.getBalance(owner)); }
      catch { setBalance(null); }
    } else {
      setBalance(null);
    }
  }, [owner]);

  useEffect(() => { void refresh(); }, [refresh]);

  const claim = async () => {
    if (!owner) return;
    setBusy(true);
    setErr(null);
    setLastTx(null);
    try {
      const response = await fetch("/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: owner.toBase58() }),
        signal: AbortSignal.timeout(30_000),
      });
      const body = await response.json() as { error?: string; signature?: string };
      if (!response.ok) throw new Error(body.error ?? "The faucet request failed.");
      setLastTx(body.signature ?? null);
      await refresh();
      onChanged();
    } catch (e) {
      setErr(readableError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card faucet-card">
      <div className="spread">
        <div>
          <p className="intro-kicker">Public demo faucet</p>
          <h2>Get demo COOK</h2>
          <p className="muted faucet-copy">
            New wallet? Claim a small amount to join the demo circle and try a
            real round on Cookie Chain. Transaction fees are sponsored separately.
          </p>
        </div>
        <span className="pill prop">live faucet</span>
      </div>

      {status && (
        <div className="faucet-stats">
          <div className="stat">per claim<b>{status.amountCook} COOK</b></div>
          <div className="stat">your balance<b>{balance === null ? "—" : formatCook(balance) + " COOK"}</b></div>
          <div className="stat">faucet tank<b>{formatCook(status.balanceLamports)} COOK</b></div>
        </div>
      )}

      {err && <div className="banner warn" role="alert">{err}</div>}
      {lastTx && (
        <div className="banner info" role="status">
          COOK sent.{" "}
          <a href={txUrl(lastTx)} target="_blank" rel="noreferrer">View transaction</a>
        </div>
      )}

      <button
        className="primary"
        disabled={!owner || busy || status === null}
        aria-busy={busy}
        onClick={claim}
      >
        {busy ? "Sending COOK..." : owner ? "Claim demo COOK" : "Connect wallet to claim"}
      </button>
      <p className="muted faucet-footnote">
        One claim per wallet/IP per minute. The faucet never signs a circle action
        for you; your contribution and collateral remain yours to approve.
      </p>
    </div>
  );
}
