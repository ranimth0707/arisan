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
      <div><span className="step-count">NETWORK SETUP</span><h2 id="network-setup-title">Add Cookie Chain to your wallet</h2></div>
    </div>
    <p className="muted">{connected && walletName ? `${walletName} has not reported Cookie Chain.` : "New wallets usually do not have this network yet."} Add it once, then select Cookie Chain before approving transactions.</p>
    <div className="network-fields">
      <div><span>RPC URL</span><code>{RPC_URL}</code><button className="text-button" onClick={() => void copy(RPC_URL, "rpc")}>{copied === "rpc" ? "Copied" : "Copy"}</button></div>
      <div><span>Native token</span><code>COOK</code><button className="text-button" onClick={() => void copy(configText, "all")}>{copied === "all" ? "Configuration copied" : "Copy all"}</button></div>
    </div>
    <ol className="network-steps"><li>Open Settings / Networks in your wallet.</li><li>Choose Add custom SVM network or Custom RPC.</li><li>Enter the RPC above, name it Cookie Chain, set COOK as the token, and save.</li></ol>
    <div className="network-setup-actions"><a className="ghost" href="https://docs.cookiechain.wtf/wallets" target="_blank" rel="noreferrer">Open wallet guide ↗</a><small>Wallet Standard has no universal add-network API, so the app cannot silently save a network to your wallet.</small></div>
    {copied === "manual" && <p className="field-error" role="status">Clipboard unavailable. Select the RPC above and copy it manually.</p>}
  </section>;
}
