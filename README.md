# Crossfire

**A room for hard questions.** Three free AI models take committed positions around a table, argue in rounds, and answer a judge at the far end. You can cut in at any time. Every transcript stays in a local SQLite file.

- **Project front door:** https://guernica4u.github.io/crossfire-arena/
- **Live app:** run it locally on `http://localhost:3000`
- **Control Panel:** `http://127.0.0.1:4310/`

Crossfire is designed for OpenRouter's free model pool. There is no billing path and no paid fallback.

## The room

The debate room is a single stage rather than a dashboard:

- Three speaker circles sit at a table. The active speaker gets a ring and a live indicator.
- The judge sits on a bench at the far end, intentionally smaller and distant. Once all three voices have spoken, the judge starts muttering to himself while the debate continues.
- The evaluation rail shows each voice's share of the floor while the debate runs. It becomes the judge's real scorecard when the verdict is recorded.
- The transcript is a quiet, readable exchange below the stage. Audience cut-ins become part of the transcript.
- The default theme is warm paper and ink with a rust accent. A dark variant is available from the header.

## Requirements

- Node.js 24 or newer (`node:sqlite` is built in)
- An [OpenRouter](https://openrouter.ai/) API key. Free-tier keys are enough.

## Setup

```bash
git clone https://github.com/Guernica4u/crossfire-arena.git
cd crossfire-arena
npm install
cp .env.example .env.local   # Windows: copy .env.example .env.local
```

Add your key to `.env.local`:

```dotenv
OPENROUTER_API_KEY=sk-or-...
```

Then start the app.

On Windows, double-click `Crossfire.vbs` (or `start-crossfire.cmd`). On any platform:

```bash
npm run go
```

The Control Panel finds the key, can save a replacement, starts the local Next.js server, and opens the arena. The full key is never printed in the panel or sent to the browser.

## The public pool

The owner key is the first key used. When it is missing or rate-limited, Crossfire can retry with keys contributed to the shared pool at `/pool`.

What the pool guarantees:

- **Free-tier only.** A contributed key is checked against OpenRouter before it is accepted. Paid keys are rejected.
- **Encrypted at rest.** Keys are sealed with AES-256-GCM. The interface only ever receives a last-four hint, a label, and timestamps.
- **Owner first.** Community keys are only selected after the owner key has failed on a retryable error.
- **Free models only.** Pool keys are passed into the same free-model chain. No paid model is used.
- **Fail closed.** A key that OpenRouter rejects with `401` or `403` is marked invalid and removed from future selection.
- **Revocable.** A contributor can revoke the key in OpenRouter at any time. The app will drop the rejected key.

By default, the encryption secret is generated once at `data/pool.secret` (gitignored). When self-hosting, set a long random `CROSSFIRE_POOL_SECRET` in the server environment instead, and back it up separately from the database. Losing the secret makes existing pool entries unreadable.

The contribution endpoint is rate-limited and same-origin protected. Do not run the pool on a public HTTP origin: terminate TLS at a reverse proxy and put appropriate request limits in front of the Node process. Contributed keys are bearer credentials; only contribute a key you are willing to have used by the app owner and other users of that deployment.

## GitHub Pages

`docs/` is a static project front door deployed with GitHub Pages. It shows the room, documents the pool, and links to setup.

GitHub Pages **cannot run this application**. The arena needs a Node server for:

- SQLite transcripts and verdicts
- server-sent event streaming
- OpenRouter calls with server-side keys
- encrypted pool storage

The live arena is local-first by design. To share a working arena, deploy the Next.js app to a Node host you control, then point the Pages site at that URL.

## Architecture

- Next.js App Router, React, TypeScript, Tailwind CSS v4.
- SQLite through Node's built-in `node:sqlite` in `src/lib/db.ts`; the database is `data/crossfire.db`.
- Debate turns stream as server-sent events from `src/app/api/debates/[id]/turn`.
- OpenRouter calls live in `src/lib/openrouter.ts`. A turn retries across free models, and across available owner/community keys, before giving up.
- The pool lives in `src/lib/pool.ts`; key records and public summaries live in `src/lib/db.ts`. The contribution UI is `/pool`.
- The Control Panel is a separate local Node process on `127.0.0.1:4310`; it binds to loopback and uses a per-run session token.
- Prompts and the judge JSON contract live in `src/lib/prompt.ts`.
- Model and persona presets live in `src/lib/agents.ts`.
- The static Pages site lives in `docs/`.

## Scripts

- `npm run go` — open the Control Panel (starts the app, manages the key, opens the arena).
- `npm run serve` — terminal-only launcher without the Control Panel.
- `npm run dev` — development server only.
- `npm run build` — production build.
- `npm run start` — serve the production build.
- `node scripts/run-turns.js <debateId> [count]` — drive turns from a terminal while `npm run dev` is running.
- `node scripts/run-judge.js <debateId>` — trigger the judge.
- `node scripts/cleanup-test.js` — remove empty interrupted/error turns and reactivate paused incomplete debates.

## Notes

- The free pool has a daily request cap, and free models are frequently rate-limited. A quick one-round debate uses around ten model calls.
- No account, billing path, paid fallback, or cloud storage is configured. The API keys stay on the server and are never sent to the browser.
- Verdicts are structured interpretations of the transcript, not fact checks.
- To reset all history, stop the server and delete `data/crossfire.db` and its `-wal` / `-shm` files. Delete `data/pool.secret` as well if you want a fresh pool encryption key.
- Free model providers may log prompts. Do not debate private information.
