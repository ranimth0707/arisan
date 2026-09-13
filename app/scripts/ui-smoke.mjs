// Server-render the public entry screens without a wallet or RPC effects.
// These are smoke checks, not browser interaction or visual regression tests.
import assert from "node:assert/strict";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";

Object.defineProperty(globalThis, "localStorage", { value: { getItem: () => null, setItem() {}, removeItem() {} }, configurable: true });
const render = (element) => renderToStaticMarkup(createElement(ConnectionProvider, { endpoint: "https://rpc.cookiescan.io" }, createElement(WalletProvider, { wallets: [], autoConnect: false }, createElement(WalletModalProvider, {}, element))));

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const { Guide } = await server.ssrLoadModule("/src/components/Guide.tsx");
  const { CreateCampaign } = await server.ssrLoadModule("/src/components/CreateCampaign.tsx");
  const { Circles } = await server.ssrLoadModule("/src/components/Circles.tsx");
  const { Faucet } = await server.ssrLoadModule("/src/components/Faucet.tsx");
  const noop = () => {};
  const guide = render(createElement(Guide, { navigate: noop }));
  assert.match(guide, /Simulasi · bukan transaksi asli/);
  assert.match(guide, /Coba setor iuran/);
  assert.match(guide, /Saya mau membuat/);
  assert.match(guide, /Pengguna teknis bisa melewati/);
  const create = render(createElement(CreateCampaign, { owner: null, program: {}, submit: noop, navigate: noop }));
  assert.match(create, /Nama campaign/);
  assert.match(create, /Tentang campaign/);
  assert.match(create, />Lanjut</);
  assert.doesNotMatch(create, /disabled=""/); // No wallet required to begin.
  const home = render(createElement(Circles, { owner: null, program: {}, submit: noop, navigate: noop, onChanged: noop, mode: "home" }));
  assert.match(home, /Create campaign/); // Creation stays visible during RPC loading.
  assert.match(home, /Memuat campaign/);
  const join = render(createElement(Circles, { owner: null, program: {}, submit: noop, navigate: noop, onChanged: noop, mode: "join" }));
  assert.match(join, /Kode room/);
  assert.match(join, /ARISAN-DEMO-9002/);
  const faucet = render(createElement(Faucet, { owner: null, onChanged: noop, navigate: noop }));
  assert.match(faucet, /Hubungkan wallet untuk klaim/);
  assert.match(faucet, /Masuk room/);
  assert.match(faucet, /Coba simulasi dulu/);
  console.log("PASS: guide, create without wallet, create during loading, join by code, and faucet next-step entry screens.");
} finally { await server.close(); }
