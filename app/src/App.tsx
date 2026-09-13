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

const pages: Record<View, { title: string; description: string }> = {
  home: { title: "Arisan dimulai dari grupmu.", description: "Buat campaign untuk orang-orang yang kamu kenal, atau masuk lewat kode dari creator." },
  campaigns: { title: "Campaign saya", description: "Room yang kamu buat atau ikuti. Iuran, anggota, dan giliran ada di sini." },
  create: { title: "Create campaign", description: "Siapkan detail, tentukan aturan, lalu bagikan undangan ke grupmu." },
  join: { title: "Join with code", description: "Masukkan kode dari creator, baca aturan campaign, lalu pilih untuk bergabung." },
  guide: { title: "Kenalan dulu dengan arisan.", description: "Coba satu putaran di bawah. Tidak perlu wallet atau COOK." },
  faucet: { title: "Get demo COOK", description: "Isi wallet untuk mencoba campaign di Cookie Chain." },
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
      <a className="skip-link" href="#main-content" onClick={e => { e.preventDefault(); document.getElementById("main-content")?.focus(); }}>Lewati navigasi</a>
      <aside className="sidebar">
        <a className="brand" href="#home" aria-label="Arisan beranda">
          <span className="brand-symbol" aria-hidden="true"><Icon name="circles" /></span>
          arisan<span className="brand-period">.</span>
        </a>
        <nav className="side-nav" aria-label="Navigasi utama">
          {([
            ["home", "home", "Beranda"], ["campaigns", "circles", "Campaign saya"],
            ["create", "plus", "Create campaign"], ["join", "enter", "Join with code"],
          ] as const).map(([key, icon, label]) => (
            <a key={key} href={"#" + key} className={view === key ? "nav-item active" : "nav-item"} aria-current={view === key ? "page" : undefined}>
              <Icon name={icon} />{label}
            </a>
          ))}
          <span className="nav-section">BANTUAN & DEMO</span>
          <a href="#guide" className={view === "guide" ? "nav-item active" : "nav-item"} aria-current={view === "guide" ? "page" : undefined}><Icon name="book" />Panduan arisan</a>
          <a href="#faucet" className={view === "faucet" ? "nav-item active" : "nav-item"} aria-current={view === "faucet" ? "page" : undefined}><Icon name="wallet" />Get demo COOK</a>
        </nav>
        <div className="sidebar-bottom"><span className="network"><i />Cookie Chain</span><span>Kas grup, giliran bersama.</span></div>
      </aside>
      <main className="main-content" id="main-content" tabIndex={-1}>
        <header className="topbar">
          <span className="breadcrumb">Arisan <span>/</span> {view === "home" ? "Beranda" : pages[view].title}</span>
          <WalletMultiButton />
        </header>
        <div className="page-content">
          <div className="page-heading"><h1 ref={heading} tabIndex={-1}>{pages[view].title}</h1><p>{pages[view].description}</p></div>
          {view === "home" && <>
            <div className="start-actions">
              <a className="start-card" href="#create"><span className="action-icon"><Icon name="plus" /></span><h2>Create campaign</h2><p>Atur arisanmu sendiri.<br /> Undang anggota lewat kode room.</p><span className="text-action">Buat campaign <Icon name="arrow" /></span></a>
              <a className="start-card join-card" href="#join"><span className="action-icon"><Icon name="enter" /></span><h2>Join with code</h2><p>Sudah diajak ikut arisan?<br /> Masukkan kode dari creator.</p><span className="text-action">Masuk room <Icon name="arrow" /></span></a>
            </div>
            <a className="learn-banner" href="#guide"><span className="learn-icon"><Icon name="book" /></span><span><strong>Baru pertama kali? Mulai dari sini.</strong><small>Simulasi 3 anggota · 1 putaran · tanpa wallet</small></span><Icon name="arrow" /></a>
          </>}
          {(["home", "campaigns", "join"] as View[]).includes(view) &&
            <Circles program={program} owner={owner} submit={submit} onChanged={() => {}} mode={view as "home" | "campaigns" | "join"} navigate={navigate} />}
          {view === "create" && <CreateCampaign program={program} owner={owner} submit={submit} navigate={navigate} />}
          {view === "guide" && <Guide navigate={navigate} />}
          {view === "faucet" && <Faucet owner={owner} onChanged={() => {}} navigate={navigate} />}
          {owner && !walletChains.knowsCookieChain && <details className="connection-note"><summary>Wallet menampilkan peringatan jaringan?</summary><p>Pastikan wallet memakai Cookie Chain. Beberapa wallet melakukan pratinjau di jaringan Solana lain. Periksa nominal dan tujuan sebelum menyetujui transaksi.</p></details>}
          {relayerChecked && !sponsored && <p className="connection-note">Sponsor sedang tidak tersedia. Biaya transaksi akan memakai saldo COOK wallet kamu.</p>}
          <footer className="app-footer"><span className="network"><i />Cookie Chain mainnet</span><a href="#guide">Butuh bantuan?</a><span className="release-note">Campaign rooms · v2</span></footer>
        </div>
      </main>
      <TxToast progress={progress} />
    </div>
  );
}
