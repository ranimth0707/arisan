import { health } from "./_relayer.js";

export default async function handler(_req, res) {
  try {
    return res.status(200).json(await health());
  } catch (e) {
    // A missing key is a deployment problem, not a user problem. Say so plainly
    // so the app can fall back to self-paid instead of looking broken.
    return res.status(503).json({ ok: false, error: e.message });
  }
}
