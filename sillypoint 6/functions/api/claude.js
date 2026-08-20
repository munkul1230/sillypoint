// Cloudflare Pages Function — POST /api/claude
// Proxies the browser's Anthropic request so the API key never ships to the client.
// Env vars (set in the Pages dashboard):
//   ANTHROPIC_API_KEY  (required) — your Anthropic key
//   CLAUDE_MODEL       (optional) — a valid API model id; overrides whatever the client sent
//
// The client (CricketAnalytics.jsx) posts the standard Messages body:
//   { model, max_tokens, messages, tools? }
// including image blocks and the web_search tool — all forwarded as-is.

export async function onRequestPost({ request, env }) {
  try {
    if (!env.ANTHROPIC_API_KEY) {
      return json({ error: { message: "ANTHROPIC_API_KEY is not set on the server." } }, 500);
    }
    const body = await request.json();
    if (env.CLAUDE_MODEL) body.model = env.CLAUDE_MODEL;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    const data = await r.json();
    return json(data, r.status);
  } catch (e) {
    return json({ error: { message: String(e && e.message ? e.message : e) } }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
