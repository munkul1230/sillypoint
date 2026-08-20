# SillyPoint — cricket analytics suite

A percentile-first cricket analytics app: opponent-aware XI selection, an auction/squad
optimiser, matchup and venue engines, real Cricsheet ball-by-ball ingestion (percentiles,
win-probability-added, aggregation), and AI video/image analysis.

This is the deployable project version of the single-file prototype.

## Go live in ~2 minutes

The `dist/` folder in this package is the **already-built website** (static HTML/CSS/JS). Two ways to publish it:

**A. Drag-and-drop (no Git, no build):**
- **Netlify Drop** — go to app.netlify.com/drop and drag the `dist` folder in. Live instantly.
- **Cloudflare Pages** — Create project → Direct Upload → drag `dist`.

> Drag-and-drop hosts the front end. The AI features (meta-analysis, Vision) need the `/api/claude` proxy, which only runs on a host that supports functions — use option B for those, or the app shows a friendly "AI unavailable" note and everything else works.

**B. Git + auto-build (recommended, enables AI):**
1. Push this folder to a GitHub repo.
2. Connect it in **Cloudflare Pages** (or Vercel): build command `npm run build`, output `dist`.
3. Add env vars `ANTHROPIC_API_KEY` and `CLAUDE_MODEL`. Deploy.

Rebuild anytime with `npm run build`.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
```

The app builds to static files:

```bash
npm run build      # -> dist/
npm run preview
```

## Lint (catches the bugs that slip past a bundler)

```bash
npm run lint
```

ESLint is configured with `no-undef` and `react/jsx-no-undef`, which catch a component
or identifier used in JSX but never defined — exactly the class of error that shipped a
broken tab in the prototype. Run it before every deploy (or wire it into CI).

## The AI / vision features need a proxy

The Batting/bowling AI report (Ask), the Vision tab, and the scouting report call an
Anthropic model. The browser must **not** hold your API key, so those calls go to
`/api/claude`, a serverless function that adds the key server-side.

- **Cloudflare Pages:** `functions/api/claude.js` is used automatically. Delete the `/api`
  folder.
- **Vercel:** `/api/claude.js` is used automatically. Delete the `functions` folder.

Set these environment variables in your host's dashboard:

- `ANTHROPIC_API_KEY` — required.
- `CLAUDE_MODEL` — recommended. A valid current API model id (the client sends a
  placeholder; the proxy overrides it with this). Set it to whatever model your account
  should use.

Without the proxy configured, the AI-dependent tabs show a friendly "AI is unavailable"
message and everything else keeps working.

> Note: on a real deployed site the on-device pose model (TensorFlow.js, loaded from a CDN)
> works — unlike the sandboxed prototype where the model host was blocked.

## Deploy

### Cloudflare Pages (recommended — free, unlimited bandwidth)
1. Push this repo to GitHub.
2. Cloudflare Pages → Create project → connect the repo.
3. Build command `npm run build`, output directory `dist`.
4. Add the env vars above. Deploy.

### Vercel
1. Push to GitHub, import in Vercel.
2. Framework preset: Vite. Build `npm run build`, output `dist`.
3. Add the env vars. Deploy.

## Project layout

```
sillypoint/
├─ index.html
├─ vite.config.js
├─ .eslintrc.cjs
├─ api/claude.js              # Vercel proxy (delete if on Cloudflare)
├─ functions/api/claude.js    # Cloudflare Pages proxy (delete if on Vercel)
└─ src/
   ├─ main.jsx
   ├─ index.css
   ├─ CricketAnalytics.jsx    # the app (one component today — split next)
   └─ lib/
      └─ cricsheet.js         # reusable Cricsheet parser (browser + Node)
```

## Suggested next steps

- **Split `CricketAnalytics.jsx`.** It's one large component today. Pull each tab into its
  own file under `src/tabs/`, shared pieces into `src/components/`, and the theme tokens
  into `src/theme.css`. The app already uses the `cricsheet.js` parser pattern — do the
  same for the metrics/percentile helpers.
- **Add a backend + database** for the real-data story: ingest Cricsheet on a schedule into
  Postgres (Neon/Supabase) or SQLite (Turso/Cloudflare D1), run the parser, WPA, and
  season aggregation server-side, and expose an API. `src/lib/cricsheet.js` runs in Node
  already, so it's the seed of that ingest job.
- **TypeScript.** Convert incrementally (rename files to `.tsx`, add `tsconfig.json`) for
  compile-time safety beyond ESLint.
- **The moat:** make the Vision "Extract data" mode reliable on real footage — that's the
  video-to-data engine, the piece worth selling.
