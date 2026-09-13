import { useCallback, useEffect, useMemo, useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

import { useCookieJar } from "./hooks/useCookieJar";
import { Circles } from "./components/Circles";
import { Faucet } from "./components/Faucet";
import { TxToast } from "./components/TxToast";
import { connection, findSponsorVault, formatCook } from "./lib/cookiejar";
import { inspectWallet } from "./lib/chain";
import { SPONSOR_AUTHORITY } from "./hooks/useCookieJar";

type Tab = "circles" | "faucet";

export default function App() {
  const { wallet, program, relayer, relayerChecked, sponsored, progress, submit } = useCookieJar();
  const [tab, setTab] = useState<Tab>("circles");
  const [gasLeft, setGasLeft] = useState<number | null>(null);
  const [nudge, setNudge] = useState(0);


  const refreshGas = useCallback(async () => {
    try {
      setGasLeft(await connection.getBalance(findSponsorVault(SPONSOR_AUTHORITY)));
    } catch {
      setGasLeft(null);
    }
  }, []);

  useEffect(() => { void refreshGas(); }, [refreshGas, nudge]);

  const owner = wallet.publicKey ?? null;

  // The Solana Wallet Standard has no equivalent of EVM's switch-chain request,
  // so an app cannot ask a wallet to move networks. It can only name the chain
  // when asking for a signature, and only if the wallet publishes that chain.
  // Nightly currently publishes solana:devnet, testnet and mainnet and nothing
  // else, even while pointed at Cookie Chain, so this warns rather than accuses.
  const walletChains = useMemo(
    () => inspectWallet(wallet.wallet, owner),
    [wallet.wallet, owner],
  );
  const cannotNameChain = Boolean(owner && !walletChains.knowsCookieChain);

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="side-brand">
          <span className="brand-mark" aria-hidden="true">🍪</span>
          <div>
            <strong>Arisan</strong>
            <span>shared savings</span>
          </div>
        </div>

        <div className="side-kicker">Workspace</div>
        <nav className="side-nav" aria-label="Primary navigation">
          <button className={`nav-item ${tab === "circles" ? "active" : ""}`} onClick={() => setTab("circles")}>
            <span className="nav-glyph" aria-hidden="true">◉</span>
            <span>Circles</span>
          </button>
          <button className={`nav-item ${tab === "faucet" ? "active" : ""}`} onClick={() => setTab("faucet")}>
            <span className="nav-glyph" aria-hidden="true">✦</span>
            <span>Get demo COOK</span>
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="chain-card">
            <span className="status-dot" aria-hidden="true" />
            <div>
              <strong>Cookie Chain</strong>
              <span>mainnet · live</span>
            </div>
          </div>
          <p>Transparent by default. Every contribution and turn stays visible to the group.</p>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="mobile-brand">
            <span className="brand-mark" aria-hidden="true">🍪</span>
            <strong>Arisan</strong>
          </div>
          <div className="topbar-actions">
            <span className="network-label"><span className="status-dot" aria-hidden="true" /> Cookie Chain</span>
            <WalletMultiButton />
          </div>
        </header>

      {relayerChecked && !sponsored && (
        <div className="banner warn global-banner">
          The gas sponsor is offline right now, so transactions will use your own
          COOK. Everything else works the same.
        </div>
      )}
      {sponsored && gasLeft !== null && (
        <div className="banner info global-banner">
          Nobody pays gas here. Joining, paying a round and taking your turn are
          all covered, with {formatCook(gasLeft)} COOK left in the sponsor tank.
          Your contribution and collateral always come from your own wallet.
        </div>
      )}

      {cannotNameChain && (
        <div className="banner warn global-banner">
          <strong>Your wallet may warn that a transaction will fail. It will not.</strong>{" "}
          {walletChains.walletName ?? "This wallet"} does not publish Cookie Chain
          through the Wallet Standard, so we cannot tell it which chain to preview
          against and it falls back to whichever Solana network it knows. Approving
          is safe: a signature covers the transaction itself and says nothing about
          the chain it runs on.
          {walletChains.chains.length > 0 && (
            <div className="mono" style={{ marginTop: 6, opacity: 0.75 }}>
              wallet publishes: {walletChains.chains.join(", ")}
            </div>
          )}
        </div>
      )}

      <div className="page-heading">
        <div>
          <p className="eyebrow">{tab === "circles" ? "Home" : "Get started"}</p>
          <h1>{tab === "circles" ? "Your circles" : "Get demo COOK"}</h1>
          <p className="page-subtitle">
            {tab === "circles"
              ? "See what is moving, what is owed, and who is next."
              : "A small, real balance to help you join the live demo circle on Cookie Chain."}
          </p>
        </div>
        <div className="page-meta">
          <span className="meta-label">Network</span>
          <span className="meta-value">Cookie Chain mainnet</span>
        </div>
      </div>

      <section className="view-wrap">
        {tab === "circles" && (
          <Circles
            program={program}
            owner={owner}
            submit={submit}
            onChanged={() => setNudge((n) => n + 1)}
          />
        )}
        {tab === "faucet" && (
          <Faucet owner={owner} onChanged={() => setNudge((n) => n + 1)} />
        )}
      </section>

      <footer className="app-footer">
        Running on Cookie Chain.{" "}
        <span className="mono">{program.programId.toBase58()}</span>
        {relayer && (
          <>
            {" · relayer "}
            <span className="mono">{relayer.toBase58().slice(0, 8)}…</span>
          </>
        )}
      </footer>

      <TxToast progress={progress} />
      </main>
    </div>
  );
}
