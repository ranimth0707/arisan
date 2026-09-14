import { useEffect, useMemo, useRef, useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useCookieJar } from "./hooks/useCookieJar";
import { Circles } from "./components/Circles";
import { CreateCampaign } from "./components/CreateCampaign";
import { Guide } from "./components/Guide";
import { Faucet } from "./components/Faucet";
import { Icon, type View } from "./components/UI";
import { TxToast } from "./components/TxToast";
import { inspectWallet } from "./lib/chain";
import { NetworkSetup } from "./components/NetworkSetup";
import { NetworkStats } from "./components/NetworkStats";

const pages: Record<View, { title: string; description: string }> = {
  home: { title: "Arisan starts with your group.", description: "Create a campaign for people you know, or enter with a creator's invite code." },
  campaigns: { title: "My campaigns", description: "The rooms you created or joined. Contributions, members, and turns live here." },
  create: { title: "Create campaign", description: "Set the details, agree on the rules, and share the invite with your group." },
  join: { title: "Join with code", description: "Enter the creator's code, read the campaign rules, and choose whether to join." },
  guide: { title: "Get to know Arisan.", description: "Try one round below. No wallet or COOK required." },
  faucet: { title: "Get demo COOK", description: "Fund your wallet to try a campaign on Cookie Chain." },
};
function currentView(): View {
  const key = location.hash.slice(1);
  return Object.hasOwn(pages, key) ? key as View : "home";
}
export default function App() {
  const { wallet, program, relayerChecked, sponsored, progress, submit } = useCookieJar();
  const [view, setView] = useState<View>(currentView);
  const heading = useRef<HTMLHeadingElement>(null);
  const owner = wallet.publicKey ?? null;
  const walletChains = useMemo(() => inspectWallet(wallet.wallet, owner), [wallet.wallet, owner]);
  useEffect(() => {
    const update = () => { setView(currentView()); window.scrollTo(0, 0); heading.current?.focus(); };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  const navigate = (next: View) => { location.hash = next; };
  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content" onClick={e => { e.preventDefault(); document.getElementById("main-content")?.focus(); }}>Skip navigation</a>
      <aside className="sidebar">
        <a className="brand" href="#home" aria-label="Arisan home">
          <span className="brand-symbol" aria-hidden="true"><Icon name="circles" /></span>
          arisan<span className="brand-period">.</span>
        </a>
        <nav className="side-nav" aria-label="Main navigation">
          {([
            ["home", "home", "Home"], ["campaigns", "circles", "My campaigns"],
            ["create", "plus", "Create campaign"], ["join", "enter", "Join with code"],
          ] as const).map(([key, icon, label]) => (
            <a key={key} href={"#" + key} className={view === key ? "nav-item active" : "nav-item"} aria-current={view === key ? "page" : undefined}>
              <Icon name={icon} />{label}
            </a>
          ))}
          <span className="nav-section">HELP & DEMO</span>
          <a href="#guide" className={view === "guide" ? "nav-item active" : "nav-item"} aria-current={view === "guide" ? "page" : undefined}><Icon name="book" />Arisan guide</a>
          <a href="#faucet" className={view === "faucet" ? "nav-item active" : "nav-item"} aria-current={view === "faucet" ? "page" : undefined}><Icon name="wallet" />Get demo COOK</a>
        </nav>
        <div className="sidebar-bottom"><span className="network"><i />Cookie Chain</span><span>Shared group pool, shared turns.</span></div>
      </aside>
      <main className="main-content" id="main-content" tabIndex={-1}>
        <header className="topbar">
          <span className="breadcrumb">Arisan <span>/</span> {view === "home" ? "Home" : pages[view].title}</span>
          <WalletMultiButton />
        </header>
        <div className="page-content">
          <div className="page-heading"><h1 ref={heading} tabIndex={-1}>{pages[view].title}</h1><p>{pages[view].description}</p></div>
          {view === "home" && <>
            <div className="start-actions">
              <a className="start-card" href="#create"><span className="action-icon"><Icon name="plus" /></span><h2>Create campaign</h2><p>Run your own Arisan.<br /> Invite members with a room code.</p><span className="text-action">Create campaign <Icon name="arrow" /></span></a>
              <a className="start-card join-card" href="#join"><span className="action-icon"><Icon name="enter" /></span><h2>Join with code</h2><p>Were you invited to an Arisan?<br /> Enter the creator's code.</p><span className="text-action">Join a room <Icon name="arrow" /></span></a>
            </div>
            <a className="learn-banner" href="#guide"><span className="learn-icon"><Icon name="book" /></span><span><strong>New here? Start with this guide.</strong><small>3-member simulation · 1 round · no wallet</small></span><Icon name="arrow" /></a>
            <NetworkStats />
          </>}
          {(["home", "campaigns", "join"] as View[]).includes(view) &&
            <Circles program={program} owner={owner} submit={submit} onChanged={() => {}} mode={view as "home" | "campaigns" | "join"} navigate={navigate} />}
          {view === "create" && <CreateCampaign program={program} owner={owner} submit={submit} navigate={navigate} />}
          {view === "guide" && <Guide navigate={navigate} />}
          {view === "faucet" && <Faucet owner={owner} onChanged={() => {}} navigate={navigate} />}
          {owner && !walletChains.knowsCookieChain && <NetworkSetup walletName={walletChains.walletName} connected />}
          {relayerChecked && !sponsored && <p className="connection-note">Transaction sponsorship is unavailable. Fees will use the COOK balance in your wallet.</p>}
          <footer className="app-footer"><span className="network"><i />Cookie Chain mainnet</span><a href="#guide">Need help?</a><span className="release-note">Campaign rooms · v2</span></footer>
        </div>
      </main>
      <TxToast progress={progress} />
    </div>
  );
}
