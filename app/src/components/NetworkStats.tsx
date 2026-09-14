import { useCallback, useEffect, useState } from "react";
import { Icon } from "./UI";

interface MetricsBucket {
  contributionCook: number;
  payoutCook: number;
  grossCook: number;
  transactions: number;
}

interface NetworkMetrics {
  asOf: string;
  source: { network: string; rpc: string; program: string };
  tvl: { activeCook: number; protectedCook: number; bondCook: number; potCook: number };
  rooms: { active: number; forming: number; protected: number };
  members: number;
  volume: { allTime: MetricsBucket; last24h: MetricsBucket; indexedSignatures: number; complete: boolean };
}

function cook(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function timeLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "baru saja" : date.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

export function NetworkStats() {
  const [data, setData] = useState<NetworkMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    setError(false);
    try {
      const response = await fetch("/api/metrics", { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error("metrics unavailable");
      setData(await response.json() as NetworkMetrics);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <section className="network-stats" aria-labelledby="network-stats-title">
      <div className="network-stats-heading">
        <div>
          <span className="eyebrow">ON-CHAIN ACTIVITY</span>
          <h2 id="network-stats-title">Arisan yang sedang berjalan</h2>
          <p>Angka ini dibaca dari vault dan transaksi Arisan di Cookie Chain.</p>
        </div>
        <button className="ghost stats-refresh" type="button" onClick={() => void refresh()} disabled={loading} aria-busy={loading}>
          <Icon name="refresh" />{loading ? "Memuat…" : "Perbarui"}
        </button>
      </div>

      {loading && <div className="stats-grid stats-loading" aria-label="Memuat statistik"><span /><span /><span /><span /></div>}
      {!loading && error && <div className="banner warn stats-error" role="alert">Statistik belum bisa dimuat. <button className="text-button" type="button" onClick={() => void refresh()}>Coba lagi</button></div>}
      {!loading && !error && data && <>
        <div className="stats-grid">
          <div className="network-stat primary-stat"><span>TVL aktif</span><strong>{cook(data.tvl.activeCook)} <small>COOK</small></strong><em>{cook(data.tvl.protectedCook)} COOK terlindungi</em></div>
          <div className="network-stat"><span>Arus kas terindeks</span><strong>{cook(data.volume.allTime.grossCook)} <small>COOK</small></strong><em>{data.volume.allTime.transactions.toLocaleString("id-ID")} transaksi kontribusi &amp; payout</em></div>
          <div className="network-stat"><span>Room aktif</span><strong>{data.rooms.active.toLocaleString("id-ID")}</strong><em>{data.rooms.forming} sedang mencari anggota</em></div>
          <div className="network-stat"><span>Anggota terdaftar</span><strong>{data.members.toLocaleString("id-ID")}</strong><em>{data.rooms.protected} room memakai safety guard</em></div>
        </div>
        <div className="network-stats-foot"><span>Diperbarui {timeLabel(data.asOf)} · {data.volume.complete ? "seluruh riwayat terindeks" : "riwayat volume masih sebagian"}</span><a href={`https://cookiescan.io/account/${data.source.program}`} target="_blank" rel="noreferrer">Verifikasi di CookieScan ↗</a></div>
      </>}
    </section>
  );
}
