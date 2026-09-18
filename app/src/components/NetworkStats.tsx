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
  volume: {
    allTime: MetricsBucket & { roundsCompleted: number; exact: boolean };
    recent: MetricsBucket & { transactions: number; windowHours: number; coversFullDay: boolean };
    scannedSignatures: number;
  };
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
          <div className="network-stat"><span>Cash flow</span><strong>{cook(data.volume.allTime.grossCook)} <small>COOK</small></strong><em>across {data.volume.allTime.roundsCompleted.toLocaleString("en-US")} completed rounds</em></div>
          <div className="network-stat"><span>Active rooms</span><strong>{data.rooms.active.toLocaleString("en-US")}</strong><em>{data.rooms.forming} looking for members</em></div>
          {/* "Members" would read as people. Most of these seats are operator-
              seeded wallets, and letting that be misread would put every other
              number here in doubt the moment somebody checked. */}
          <div className="network-stat"><span>Seats taken</span><strong>{data.members.toLocaleString("en-US")}</strong><em>{data.rooms.protected} rooms using the safety guard</em></div>
        </div>
        <p className="stats-disclosure">
          Most of these seats and most of this TVL are operator-seeded, not organic demand.
          The COOK is real and locked under the same rules as anyone else&rsquo;s, and every
          figure here is recomputed from the chain rather than stored — but it shows the
          mechanism running, not people wanting it yet.{" "}
          <a href="https://github.com/ranimth0707/arisan#seeded-liquidity-said-out-loud" target="_blank" rel="noreferrer">How this was seeded ↗</a>
        </p>
        <div className="network-stats-foot"><span>Updated {timeLabel(data.asOf)} · cash flow read from circle state, not sampled · {cook(data.volume.recent.grossCook)} COOK in the last {data.volume.recent.windowHours}h</span><a href={`https://cookiescan.io/address/${data.source.program}`} target="_blank" rel="noreferrer">Verify on CookieScan ↗</a></div>
      </>}
    </section>
  );
}
