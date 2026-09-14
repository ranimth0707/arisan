// Local stand-in for the Vercel functions, so development and production run
// the exact same validation code rather than two copies that can drift.
//
//   RELAYER_SECRET_KEY="$(cat ~/.config/solana/cookiejar-relayer.json)" \
//     node relayer/dev-server.js

import http from "node:http";
import { health, rateLimited, sponsor } from "../app/api/_relayer.js";
import { dispense, faucetAmount, faucetStatus } from "../app/api/_faucet.js";
import { clientAddress } from "../app/api/faucet.js";

const PORT = Number(process.env.PORT ?? 8787);

const json = (res, status, body) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(body));
};

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, "http://local").pathname.replace(/^\/api/, "");

  if (req.method === "OPTIONS") return json(res, 204, {});

  if (path === "/health") {
    try { return json(res, 200, await health()); }
    catch (e) { return json(res, 503, { ok: false, error: e.message }); }
  }

  if (path === "/faucet" && req.method === "GET") {
    try { return json(res, 200, await faucetStatus()); }
    catch (e) { return json(res, 503, { ok: false, error: e.message }); }
  }

  if (path === "/faucet" && req.method === "POST") {
    const client = clientAddress(req.headers, req.socket);
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 8_192) return json(res, 413, { error: "too large" });
    }
    try {
      const { wallet } = JSON.parse(body);
      if (typeof wallet !== "string") {
        return json(res, 400, { error: "expected a wallet address" });
      }
      return json(res, 200, await dispense(wallet, client));
    } catch (e) {
      return json(res, e.status ?? 500, { error: e.message, amountCook: faucetAmount() });
    }
  }

  if (path === "/sponsor" && req.method === "POST") {
    const client = req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "unknown";
    if (rateLimited(String(client))) {
      return json(res, 429, { error: "too many requests, slow down" });
    }
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 65_536) return json(res, 413, { error: "too large" });
    }
    try {
      const { transaction } = JSON.parse(body);
      if (typeof transaction !== "string") {
        return json(res, 400, { error: "expected a base64 transaction" });
      }
      return json(res, 200, await sponsor(transaction));
    } catch (e) {
      return json(res, e.status ?? 400, { error: e.message, logs: e.logs });
    }
  }

  return json(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`relayer dev server on :${PORT}`);
});
