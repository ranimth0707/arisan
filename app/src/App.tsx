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
    <div className="shell">
      <header className="bar">
        <div className="brand">
          <span className="jar">🍪</span>
          <div>
            <h1>Arisan</h1>
            <p className="tagline">Rotating savings where nobody can run off with the pot</p>
          </div>
        </div>
        <WalletMultiButton />
      </header>

      {relayerChecked && !sponsored && (
        <div className="banner warn">
          The gas sponsor is offline right now, so transactions will use your own
          COOK. Everything else works the same.
        </div>
      )}
      {sponsored && gasLeft !== null && (
        <div className="banner info">
          Nobody pays gas here. Joining, paying a round and taking your turn are
          all covered, with {formatCook(gasLeft)} COOK left in the sponsor tank.
          Your contribution and collateral always come from your own wallet.
        </div>
      )}

      {cannotNameChain && (
        <div className="banner warn">
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

      <>
          <nav className="tabs">
            <button className={`tab ${tab === "circles" ? "on" : ""}`} onClick={() => setTab("circles")}>
              🍪 Circles
            </button>
            <button className={"tab " + (tab === "faucet" ? "on" : "")} onClick={() => setTab("faucet")}>
              ⚡ Get demo COOK
            </button>
          </nav>

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
      </>

      <footer className="muted" style={{ marginTop: 40, textAlign: "center", fontSize: 12 }}>
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
    </div>
  );
}
