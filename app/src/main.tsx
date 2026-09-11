import { Buffer } from "buffer";

// Anchor and web3.js expect Buffer to exist globally, which it does not in a
// browser. Shimmed before anything else imports them.
globalThis.Buffer ??= Buffer;

import React, { useMemo } from "react";
import ReactDOM from "react-dom/client";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";

import App from "./App";
import { RPC_URL } from "./lib/cookiejar";
import "./index.css";

function Root() {
  const endpoint = useMemo(() => RPC_URL, []);

  // Left empty on purpose. Nightly registers itself through the Solana Wallet
  // Standard, so it is discovered automatically along with any other installed
  // standard wallet. Hardcoding adapters would only narrow that list.
  const wallets = useMemo(() => [], []);

  return (
    <ConnectionProvider endpoint={endpoint} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <App />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
