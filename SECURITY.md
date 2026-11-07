# Security

## API keys

Crossfire uses OpenRouter keys as bearer credentials. They must stay server-side.

- The owner key is read from `.env.local` (or the server environment) and is never returned to the browser.
- The Control Panel stores the owner key in `.env.local` and only exposes a masked hint.
- Community keys are validated with OpenRouter's key endpoint, encrypted with AES-256-GCM, and stored in the local SQLite database.
- The pool API returns only a last-four hint, label, contributor name, and timestamps.
- The encryption secret is generated at `data/pool.secret`, or supplied as `CROSSFIRE_POOL_SECRET`. It is gitignored. Do not commit it or place it in the browser bundle.
- A contributed key can be revoked in OpenRouter at any time. Crossfire marks a key invalid after a `401` or `403` response.

Never paste an API key into an issue, pull request, chat message, screenshot, or commit. If a key is exposed, revoke it in OpenRouter immediately.

## Public pool deployment

The contribution endpoint is intended for a server you control.

- Serve the app over HTTPS.
- Put request limits at the reverse proxy in addition to the app's global contribution rate limit.
- Only free-tier keys are accepted; paid keys are rejected.
- Do not use a shared organization key as a public contribution.
- Losing `CROSSFIRE_POOL_SECRET` makes existing pool entries unreadable.
- GitHub Pages is static and cannot host the pool, the API routes, or the SQLite database.

## Reporting

Use GitHub's private vulnerability reporting on this repository if available. Do not include real API keys or user transcripts in a report.
