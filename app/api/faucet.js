import { dispense, faucetAmount, faucetStatus } from "./_faucet.js";

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

  const client = req.headers["x-forwarded-for"] ?? req.socket?.remoteAddress ?? "unknown";
  const wallet = req.body?.wallet;
  if (typeof wallet !== "string") {
    return res.status(400).json({ error: "expected a wallet address" });
  }

  try {
    return res.status(200).json(await dispense(wallet, String(client).split(",")[0].trim()));
  } catch (e) {
    return res.status(e.status ?? 500).json({ error: e.message });
  }
}

export { faucetAmount };
