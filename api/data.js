// Vercel serverless function: stores clients, invoices and settings so every device sees the same data.
// Needs: APP_PASSWORD, and an Upstash Redis database connected to the project (Vercel > Storage).
module.exports = async (req, res) => {
  const pw = process.env.APP_PASSWORD;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const tok =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!pw) {
    res.status(500).json({ error: "APP_PASSWORD is not set" });
    return;
  }
  if (req.headers["x-app-password"] !== pw) {
    res.status(401).json({ error: "Wrong password" });
    return;
  }
  if (!url || !tok) {
    res.status(501).json({ error: "Storage not connected" });
    return;
  }
  const KEY = "session-invoicer:data";
  const redis = async (cmd) => {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + tok,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(cmd),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j.result;
  };
  try {
    const raw = await redis(["GET", KEY]);
    const cur = raw ? JSON.parse(raw) : null;
    if (req.method === "GET") {
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({ data: cur });
      return;
    }
    if (req.method === "PUT" || req.method === "POST") {
      const body =
        typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      if (!body.data || !Array.isArray(body.data.clients)) {
        res.status(400).json({ error: "Bad data" });
        return;
      }
      if (cur && cur.updated !== body.base) {
        res.status(409).json({ current: cur });
        return;
      }
      await redis(["SET", KEY, JSON.stringify(body.data)]);
      res.status(200).json({ ok: true, updated: body.data.updated });
      return;
    }
    res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    res.status(502).json({ error: "Storage error" });
  }
};
