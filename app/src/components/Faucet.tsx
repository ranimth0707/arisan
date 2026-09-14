import { useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Icon, type Navigate } from "./UI";
import { NetworkSetup } from "./NetworkSetup";

import { connection, formatCook, readableError, txUrl } from "../lib/cookiejar";

interface Props {
  owner: PublicKey | null;
  onChanged: () => void;
  navigate: Navigate;
}

interface FaucetStatus {
  amountCook: number;
  balanceLamports: number;
}

/** A small, rate-limited COOK tap for trying the live app with a new wallet. */
export function Faucet({ owner, onChanged, navigate }: Props) {
  const [status, setStatus] = useState<FaucetStatus | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setErr(null);
    try {
      const res = await fetch("/api/faucet", { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error("The faucet is temporarily unavailable. Try again shortly.");
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

  return <div className="faucet-layout">
    <section className="faucet-card">
      <span className="action-icon"><Icon name="wallet" /></span>
      <h2>Get a balance to try it.</h2>
      <p className="faucet-copy">Faucet COOK covers the reserve when you join and contributions each round. These are real transactions on Cookie Chain mainnet.</p>
      <div className="faucet-stats">
        <div className="stat">COOK per claim<b>{status ? status.amountCook : "—"} COOK</b></div>
        <div className="stat">Your wallet balance<b>{balance === null ? "—" : formatCook(balance)} COOK</b></div>
      </div>
      {err && <div className="banner warn" role="alert">{err} <button className="text-button" onClick={() => void refresh()}>Try again</button></div>}
      {lastTx && <div className="banner info" role="status">COOK sent. <a href={txUrl(lastTx)} target="_blank" rel="noreferrer">View transaction ↗</a></div>}
      {!owner ? <WalletMultiButton>Connect wallet to claim</WalletMultiButton> : <button className="primary" disabled={busy || status === null} aria-busy={busy} onClick={() => void claim()}>{busy ? "Sending COOK…" : "Claim demo COOK"}<Icon name="arrow" /></button>}
      <p className="faucet-footnote">One claim per wallet/IP per minute. {status ? "Faucet balance: " + formatCook(status.balanceLamports) + " COOK. " : ""}Every campaign action still requires your approval. Room creation uses your wallet balance; other actions try sponsorship when available.</p>
    </section>
    <NetworkSetup />
    <aside className="faucet-next"><h3>What next?</h3><ol><li>Open Join with code.</li><li>Use the creator's code or the available demo code.</li><li>Read the room details, then join and contribute the agreed amount.</li><li>Wait for the creator to start, then pay each round.</li></ol><button className="primary" onClick={() => navigate("join")}>Open a room<Icon name="arrow" /></button><p className="faucet-footnote">Just want to learn without a transaction? <a href="#guide">Try the simulation first.</a></p></aside>
  </div>;
}
