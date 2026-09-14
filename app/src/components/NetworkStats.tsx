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
  return Number.isNaN(date.valueOf()) ? "just now" : date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
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
          <h2 id="network-stats-title">Live Arisan activity</h2>
          <p>Read directly from Arisan vaults and confirmed transactions on Cookie Chain.</p>
        </div>
        <button className="ghost stats-refresh" type="button" onClick={() => void refresh()} disabled={loading} aria-busy={loading}>
          <Icon name="refresh" />{loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {loading && <div className="stats-grid stats-loading" aria-label="Loading network statistics"><span /><span /><span /><span /></div>}
      {!loading && error && <div className="banner warn stats-error" role="alert">Stats are temporarily unavailable. <button className="text-button" type="button" onClick={() => void refresh()}>Try again</button></div>}
      {!loading && !error && data && <>
        <div className="stats-grid">
          <div className="network-stat primary-stat"><span>Active TVL</span><strong>{cook(data.tvl.activeCook)} <small>COOK</small></strong><em>{cook(data.tvl.protectedCook)} COOK protected</em></div>
          <div className="network-stat"><span>Indexed cash flow</span><strong>{cook(data.volume.allTime.grossCook)} <small>COOK</small></strong><em>{data.volume.allTime.transactions.toLocaleString("en-US")} contribution &amp; payout transactions</em></div>
          <div className="network-stat"><span>Active rooms</span><strong>{data.rooms.active.toLocaleString("en-US")}</strong><em>{data.rooms.forming} looking for members</em></div>
          <div className="network-stat"><span>Registered members</span><strong>{data.members.toLocaleString("en-US")}</strong><em>{data.rooms.protected} rooms using the safety guard</em></div>
        </div>
        <div className="network-stats-foot"><span>Updated {timeLabel(data.asOf)} · {data.volume.complete ? "complete history indexed" : "volume history is partial"}</span><a href={`https://cookiescan.io/address/${data.source.program}`} target="_blank" rel="noreferrer">Verify on CookieScan ↗</a></div>
      </>}
    </section>
  );
}
