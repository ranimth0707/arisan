import { useCallback, useEffect, useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

import { useCookieJar } from "./hooks/useCookieJar";
import { Jars } from "./components/Jars";
import { Cookies } from "./components/Cookies";
import { Claim } from "./components/Claim";
import { Sponsor } from "./components/Sponsor";
import { TxToast } from "./components/TxToast";
import { connection, findSponsorVault, formatCook, formatCount } from "./lib/cookiejar";
import { SPONSOR_AUTHORITY } from "./hooks/useCookieJar";

type Tab = "jars" | "cookies" | "gas";

export default function App() {
  const { wallet, program, relayer, relayerChecked, sponsored, progress, submit } = useCookieJar();
  const [tab, setTab] = useState<Tab>("jars");
  const [gasLeft, setGasLeft] = useState<number | null>(null);
  const [nudge, setNudge] = useState(0);

  const cookieParam = new URLSearchParams(window.location.search).get("cookie");

  const refreshGas = useCallback(async () => {
    try {
      setGasLeft(await connection.getBalance(findSponsorVault(SPONSOR_AUTHORITY)));
    } catch {
      setGasLeft(null);
    }
  }, []);

  useEffect(() => { void refreshGas(); }, [refreshGas, nudge]);

  const owner = wallet.publicKey ?? null;

  return (
    <div className="shell">
      <header className="bar">
        <div className="brand">
          <span className="jar">🍪</span>
          <div>
            <h1>Cookie Jar</h1>
            <p className="tagline">Giveaways that fill the jar instead of emptying it</p>
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
          Gas is covered for everyone. {formatCook(gasLeft)} COOK left in the
          sponsor tank, good for at least {formatCount(Math.floor(gasLeft / 5_000_000))}{" "}
          more free claims.
        </div>
      )}

      {cookieParam ? (
        <Claim
          program={program}
          owner={owner}
          submit={submit}
          sponsored={sponsored}
          address={cookieParam}
        />
      ) : (
        <>
          <nav className="tabs">
            <button className={`tab ${tab === "jars" ? "on" : ""}`} onClick={() => setTab("jars")}>
              🍪 Jars
            </button>
            <button className={`tab ${tab === "cookies" ? "on" : ""}`} onClick={() => setTab("cookies")}>
              🥠 Fortune cookies
            </button>
            <button className={`tab ${tab === "gas" ? "on" : ""}`} onClick={() => setTab("gas")}>
              ⚡ Gas
            </button>
          </nav>

          {tab === "jars" && (
            <Jars
              program={program}
              owner={owner}
              submit={submit}
              onChanged={() => setNudge((n) => n + 1)}
            />
          )}
          {tab === "cookies" && (
            <Cookies program={program} owner={owner} submit={submit} />
          )}
          {tab === "gas" && (
            <Sponsor
              program={program}
              owner={owner}
              submit={submit}
              onChanged={() => setNudge((n) => n + 1)}
            />
          )}
        </>
      )}

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
