import { rateLimited, sponsor } from "./_relayer.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const client = req.headers["x-forwarded-for"] ?? req.socket?.remoteAddress ?? "unknown";
  if (rateLimited(String(client).split(",")[0].trim())) {
    return res.status(429).json({ error: "too many requests, slow down" });
  }

  const transaction = req.body?.transaction;
  if (typeof transaction !== "string") {
    return res.status(400).json({ error: "expected a base64 transaction" });
  }

  try {
    return res.status(200).json(await sponsor(transaction));
  } catch (e) {
    return res.status(e.status ?? 500).json({ error: e.message, logs: e.logs });
  }
}
