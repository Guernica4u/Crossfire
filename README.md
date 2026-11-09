# Crossfire

**A room for hard questions.** Three free AI models take committed positions around a table, argue in rounds, and answer a judge at the far end. You can cut in at any time. Every transcript is kept in the shared archive.

- **Live app:** https://site-2a4337a8b0494c409d081c6612ae611d.freebuff.page
- **Project front door:** https://guernica4u.github.io/Crossfire/
- **Source:** https://github.com/Guernica4u/Crossfire

Crossfire runs as a Next.js app on Freebuff Sites, with Cloudflare D1 for persistence. It is designed for OpenRouter's free model pool. There is no billing path and no paid fallback.

## The room

The debate room is a single stage rather than a dashboard:

- Three speaker circles sit at a table. The active speaker gets a ring and a live indicator.
- The judge sits on a bench at the far end, intentionally smaller and distant. Once all three voices have spoken, the judge starts muttering to himself while the debate continues.
- The evaluation rail shows each voice's share of the floor while the debate runs. It becomes the judge's real scorecard when the verdict is recorded.
- The transcript is a quiet, readable exchange below the stage. Audience cut-ins become part of the transcript.
- The default theme is warm paper and ink with a rust accent. A dark variant is available from the header.
- New turns play automatically during a live debate. Archived debates open with auto-read off unless you previously chose a preference; that preference is remembered. Use **Mute** beside any seat (or the judge's bench) to silence that voice until you unmute it; the speaker on a completed turn or the verdict replays it. Audio uses the browser's built-in voices, so no extra key or service is required.

## Use the hosted app

Open the live app above. No local setup is needed.

The owner key and the public-pool encryption secret are server-side deployment secrets. They are never sent to the browser. Debate transcripts and community pool records live in the deployment's D1 database.

## Run it locally

Requirements:

- Node.js 24 or newer
- An [OpenRouter](https://openrouter.ai/) free-tier API key

```bash
git clone https://github.com/Guernica4u/Crossfire.git
cd Crossfire
npm install
cp .env.example .env.local   # Windows: copy .env.example .env.local
```

Add both values to `.env.local`:

```dotenv
OPENROUTER_API_KEY=sk-or-...
CROSSFIRE_POOL_SECRET=use-a-long-random-server-side-value
```

Optionally set `NEXT_PUBLIC_SITE_URL` to the deployment URL used for OpenRouter attribution.

Then start the app:

```bash
npm run dev
```

On Windows, `npm run go` opens the local Control Panel, which can save the key and start the app. The Control Panel binds to loopback only.

Local development uses the same SQL schema through the OpenNext D1 adapter. If the Workers runtime cannot start — Windows hosts sometimes reject its local storage directory — Crossfire falls back to Node's built-in SQLite at `data/crossfire.db` instead of leaving the app without a database. Set `CROSSFIRE_LOCAL_DB=1` to choose SQLite explicitly, or `CROSSFIRE_USE_WORKERD=1` to force the local D1 emulator. The schema is created on first use.

## The public pool

The owner key is the first key used. When it is missing or rate-limited, Crossfire can retry with keys contributed to the shared pool at `/pool`.

What the pool guarantees:

- **Free-tier only.** A contributed key is checked against OpenRouter before it is accepted. Paid keys are rejected.
- **Encrypted at rest.** Keys are sealed with AES-256-GCM using the Web Crypto API. The interface only ever receives a last-four hint, a label, and timestamps.
- **Owner first.** Community keys are only selected after the owner key has failed on a retryable error.
- **Free models only.** Pool keys are passed into the same free-model chain. No paid model is used.
- **Fail closed.** A key that OpenRouter rejects with `401` or `403` is marked invalid and removed from future selection.
- **Revocable.** A contributor can revoke the key in OpenRouter at any time. The app will drop the rejected key.

`CROSSFIRE_POOL_SECRET` is required wherever the pool is enabled. Keep it stable and back it up separately from the database. Losing the secret makes existing pool entries unreadable.

The contribution endpoint is rate-limited and same-origin protected. Contributed keys are bearer credentials; only contribute a key you are willing to have used by the app owner and other users of that deployment.

## Reliability and limits

- A stopped debate keeps its transcript. The room shows the saved upstream error and a **Retry turn** action that resumes with the same speaker, so a rate-limit blip does not require a new debate.
- Transient upstream failures retry against another available key first, then another free model, with a short backoff. Assigned models are preferred before reusing a model already at the table.
- Debate creation checks the free quota first. If there is not enough capacity for the selected format, it refuses to start instead of leaving a half-finished debate.
- Debate creation, turns, judge calls, interjections, and pool contributions have per-IP fixed-window limits backed by D1.
- Truncated model output is detected from the stream's finish reason and continued once before it is saved.
- `GET /api/health` reports D1, owner-key presence, pool counts, and debate totals without calling OpenRouter.

## Deployment

The hosted app is a Cloudflare Worker produced by OpenNext, with a D1 binding named `DB`. Preview and production use isolated D1 databases. The schema is applied at runtime on first access.

Deployment secrets must be set in the hosting environment:

- `OPENROUTER_API_KEY`
- `CROSSFIRE_POOL_SECRET`
- `NEXT_PUBLIC_SITE_URL` (optional; defaults to the hosted URL)

Do not commit either value. `.env.local` is for local development only.

`docs/` is a static project front door deployed with GitHub Pages. GitHub Pages cannot run the arena itself: the app needs a Worker for API routes, server-sent events, D1 storage, and server-side keys. The Pages front door links to the hosted app.

## Architecture

- Next.js App Router, React, TypeScript, Tailwind CSS v4.
- Cloudflare Worker via `@opennextjs/cloudflare`, deployed with Freebuff Sites.
- Cloudflare D1 through the `DB` binding in `src/lib/db.ts`; schema creation and all debate/pool persistence are async.
- Debate turns stream as server-sent events from `src/app/api/debates/[id]/turn`.
- OpenRouter calls live in `src/lib/openrouter.ts`. A turn retries across available owner/community keys, then across free models, with backoff before giving up.
- Turn ordering lives in `src/lib/debate-state.ts`; capacity estimates live in `src/lib/capacity.ts`.
- Per-IP limits live in `src/lib/rate-limit.ts` and `consumeRateLimit` in `src/lib/db.ts`.
- The pool lives in `src/lib/pool.ts`; it uses Web Crypto AES-GCM and HMAC. Key records and public summaries live in `src/lib/db.ts`. The contribution UI is `/pool`.
- The Control Panel is a separate local Node process on `127.0.0.1:4310`; it binds to loopback and uses a per-run session token.
- Prompts and the judge JSON contract live in `src/lib/prompt.ts`. The judge sees names, assigned positions, and the transcript, never model IDs.
- Model and persona presets live in `src/lib/agents.ts`.
- The static Pages site lives in `docs/`.

## Scripts

- `npm run dev` — local development server.
- `npm run go` — open the local Control Panel (starts the app, manages the key, opens the arena).
- `npm run serve` — terminal-only local launcher without the Control Panel.
- `npm run build` — production Next.js build.
- `npm test` — unit tests for turn order, judge normalization, fallback ordering, and output sanitizing.
- `node scripts/run-turns.js <debateId> [count]` — drive turns from a terminal while `npm run dev` is running.
- `node scripts/run-judge.js <debateId>` — trigger the judge.

## Notes

- The free pool has a daily request cap, and free models are frequently rate-limited. A quick one-round debate uses around ten model calls.
- No account, billing path, or paid fallback is configured. API keys stay on the server and are never sent to the browser.
- Verdicts are structured interpretations of the transcript, not fact checks.
- Free model providers may log prompts. Do not debate private information.
- The shared archive is visible to anyone with access to the deployment.
