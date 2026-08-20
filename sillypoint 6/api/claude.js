// Vercel Serverless Function — POST /api/claude  (alternative to the Cloudflare version)
// If you deploy on Vercel, this file is used and functions/api/claude.js is ignored.
// If you deploy on Cloudflare Pages, delete this /api folder and keep functions/api/claude.js.
//
// Env vars (Vercel dashboard): ANTHROPIC_API_KEY (required), CLAUDE_MODEL (optional).

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: { message: "Method not allowed" } });
    return;
  }
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(500).json({ error: { message: "ANTHROPIC_API_KEY is not set on the server." } });
      return;
    }
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (process.env.CLAUDE_MODEL) body.model = process.env.CLAUDE_MODEL;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(500).json({ error: { message: String(e && e.message ? e.message : e) } });
  }
}
