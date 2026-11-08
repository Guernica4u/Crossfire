# Security

## API keys

Crossfire uses OpenRouter keys as bearer credentials. They must stay server-side.

- The owner key is read from the server environment (`OPENROUTER_API_KEY`) and is never returned to the browser.
- The local Control Panel can save a key to `.env.local` and only exposes a masked hint. `.env.local` is gitignored.
- Hosted deployments must set `OPENROUTER_API_KEY` as a server-side secret in the hosting environment.
- Community keys are validated with OpenRouter's key endpoint, encrypted with AES-256-GCM, and stored in Cloudflare D1.
- The pool API returns only a last-four hint, label, contributor name, and timestamps.
- `CROSSFIRE_POOL_SECRET` is required wherever the pool is enabled. It is a server-side secret, never part of the browser bundle. Do not commit it.
- A contributed key can be revoked in OpenRouter at any time. Crossfire marks a key invalid after a `401` or `403` response.

Never paste an API key into an issue, pull request, chat message, screenshot, or commit. If a key is exposed, revoke it in OpenRouter immediately.

## Public pool deployment

The contribution endpoint is intended for the hosted app.

- Serve the app over HTTPS. The production deployment uses Freebuff Sites.
- Keep request limits at the edge in addition to the app's global contribution rate limit.
- Only free-tier keys are accepted; paid keys are rejected.
- Do not use a shared organization key as a public contribution.
- Contributed keys are bearer credentials. Only contribute a key you are willing to have used by the deployment owner and other users of that deployment.
- Losing `CROSSFIRE_POOL_SECRET` makes existing pool entries unreadable.
- GitHub Pages is static and cannot host the pool, the API routes, server-sent events, or the D1 database. It is only the project front door.

## Data

Debate transcripts, verdicts, positions, and pool records live in the deployment's Cloudflare D1 database. Preview and production use isolated databases. There are no user accounts. Anyone with access to the deployment can read its shared archive.

## Reporting

Use GitHub's private vulnerability reporting on this repository if available. Do not include real API keys or user transcripts in a report.
