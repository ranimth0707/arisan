import { useState } from "react";
import { Icon } from "./UI";
import { CHAIN_ID, EXPLORER, GENESIS_HASH, RPC_URL } from "../lib/chain";

const configText = `Network: Cookie Chain
Type: Custom SVM / Solana-compatible
RPC URL: ${RPC_URL}
Explorer: ${EXPLORER}
Native token: COOK
Genesis hash: ${GENESIS_HASH}
CAIP-2: ${CHAIN_ID}`;

export function NetworkSetup({ walletName, connected = false }: { walletName?: string | null; connected?: boolean }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(current => current === label ? null : current), 1800);
    } catch { setCopied("manual"); }
  };
  return <section className="network-setup" aria-labelledby="network-setup-title">
    <div className="network-setup-heading">
      <span className="network-setup-icon"><Icon name="wallet" /></span>
      <div><span className="step-count">NETWORK SETUP</span><h2 id="network-setup-title">Tambahkan Cookie Chain ke wallet</h2></div>
    </div>
    <p className="muted">{connected && walletName ? `${walletName} belum melaporkan Cookie Chain.` : "Wallet baru biasanya belum punya network ini."} Tambahkan sekali, lalu pilih Cookie Chain sebelum menyetujui transaksi.</p>
    <div className="network-fields">
      <div><span>RPC URL</span><code>{RPC_URL}</code><button className="text-button" onClick={() => void copy(RPC_URL, "rpc")}>{copied === "rpc" ? "Tersalin" : "Salin"}</button></div>
      <div><span>Native token</span><code>COOK</code><button className="text-button" onClick={() => void copy(configText, "all")}>{copied === "all" ? "Konfigurasi tersalin" : "Salin semua"}</button></div>
    </div>
    <ol className="network-steps"><li>Buka Settings / Networks di wallet.</li><li>Pilih Add custom SVM network atau Custom RPC.</li><li>Masukkan RPC di atas, beri nama Cookie Chain, token COOK, lalu simpan.</li></ol>
    <div className="network-setup-actions"><a className="ghost" href="https://docs.cookiechain.wtf/wallets" target="_blank" rel="noreferrer">Buka panduan wallet ↗</a><small>Wallet Standard belum punya API add-network universal, jadi aplikasi tidak bisa menyimpan network ke wallet secara diam-diam.</small></div>
    {copied === "manual" && <p className="field-error" role="status">Clipboard tidak tersedia. Pilih RPC di atas lalu salin manual.</p>}
  </section>;
}
