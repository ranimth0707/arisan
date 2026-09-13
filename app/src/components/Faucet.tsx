import { useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Icon, type Navigate } from "./UI";

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
      if (!res.ok) throw new Error("Faucet sedang tidak tersedia. Coba lagi sebentar.");
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
      <h2>Siapkan saldo untuk mencoba.</h2>
      <p className="faucet-copy">COOK dari faucet bisa dipakai untuk jaminan saat join dan iuran setiap putaran. Ini transaksi nyata di Cookie Chain mainnet.</p>
      <div className="faucet-stats">
        <div className="stat">COOK per klaim<b>{status ? status.amountCook : "—"} COOK</b></div>
        <div className="stat">Saldo wallet kamu<b>{balance === null ? "—" : formatCook(balance)} COOK</b></div>
      </div>
      {err && <div className="banner warn" role="alert">{err} <button className="text-button" onClick={() => void refresh()}>Coba lagi</button></div>}
      {lastTx && <div className="banner info" role="status">COOK sudah dikirim. <a href={txUrl(lastTx)} target="_blank" rel="noreferrer">Lihat transaksi ↗</a></div>}
      {!owner ? <WalletMultiButton>Hubungkan wallet untuk klaim</WalletMultiButton> : <button className="primary" disabled={busy || status === null} aria-busy={busy} onClick={() => void claim()}>{busy ? "Mengirim COOK…" : "Claim demo COOK"}<Icon name="arrow" /></button>}
      <p className="faucet-footnote">Satu klaim per wallet/IP per menit. {status ? "Sisa faucet: " + formatCook(status.balanceLamports) + " COOK. " : ""}Setiap tindakan di campaign tetap memerlukan persetujuanmu. Biaya membuat room memakai saldo wallet; tindakan lain mencoba sponsor jika tersedia.</p>
    </section>
    <aside className="faucet-next"><h3>Setelah dapat COOK?</h3><ol><li>Buka Join with code.</li><li>Gunakan kode dari creator, atau kode demo yang tersedia.</li><li>Baca detail room, lalu Join dan setor jaminan.</li><li>Tunggu creator memulai, lalu bayar iuran.</li></ol><button className="primary" onClick={() => navigate("join")}>Masuk room<Icon name="arrow" /></button><p className="faucet-footnote">Hanya ingin belajar tanpa transaksi? <a href="#guide">Coba simulasi dulu.</a></p></aside>
  </div>;
}
