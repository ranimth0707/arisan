import { dispense, faucetAmount, faucetStatus } from "./_faucet.js";

/**
 * The client-facing edge sets `x-real-ip` itself, so it is the only header here
 * a caller cannot choose. `x-forwarded-for` is a list the client can prepend to,
 * which is why the LAST entry is used rather than the first: everything to the
 * left of it may have been supplied by whoever is being rate limited.
 */
export function clientAddress(headers, socket) {
  const real = headers["x-real-ip"];
  if (typeof real === "string" && real.trim()) return real.trim();

  const forwarded = headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    const hops = forwarded.split(",").map((hop) => hop.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return socket?.remoteAddress ?? "unknown";
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    try {
      return res.status(200).json(await faucetStatus());
    } catch (e) {
      return res.status(503).json({ ok: false, error: e.message });
    }
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "GET or POST only" });
  }

  const wallet = req.body?.wallet;
  if (typeof wallet !== "string") {
    return res.status(400).json({ error: "expected a wallet address" });
  }

  try {
    return res.status(200).json(
      await dispense(wallet, clientAddress(req.headers, req.socket)),
    );
  } catch (e) {
    return res.status(e.status ?? 500).json({ error: e.message });
  }
}

export { faucetAmount };
