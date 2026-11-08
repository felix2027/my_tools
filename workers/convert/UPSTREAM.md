# Upstream synchronization (2026-11-08)

`worker.js` was built without source modifications from jwyGithub/sub-convert commit
`af335d1d897051f94a034cb77b6aa2d2f7d45d4c` (2026-10-12).
Source: https://github.com/jwyGithub/sub-convert/commit/af335d1d897051f94a034cb77b6aa2d2f7d45d4c

Build: Node 24.21.0, pnpm 10.32.1, upstream pnpm-lock.yaml, frozen-lockfile installation (hoisted layout, dependency lifecycle scripts disabled), `pnpm run build:worker`.
Checks: upstream tests (8/8), `tsc --noEmit`, ESLint, bundled-worker offline smoke tests, and an in-memory SQLite migration test passed.
The existing Variables.env and DB binding name were preserved. No deployment, push, or production database change was performed.

## Before deployment

- Keep the existing D1 binding named `DB` and database `shurt_url`. Without DB, upstream disables short URL services.
- Back up D1 and inspect `PRAGMA table_info(short_url)` first. If `created_at` is absent, apply `migrations/001_add_created_at.sql` exactly once to the intended database. The migration is additive and preserves existing rows; it is not idempotent. Existing rows have NULL timestamps.
- NEVER apply upstream `schema.sql` to an existing database: it starts with `DROP TABLE IF EXISTS short_url` and would destroy saved links. It is deliberately not included here.
- Set a strong `SHORT_URL_KEY` as a Cloudflare secret if using the `/shortUrl` management page. No key was generated or saved. Management list/query/delete require `X-Admin-Key`; ordinary short-link creation remains public upstream behavior.
- Existing `LOCK_BACKEND=false` and custom `REMOTE_CONFIG` are unchanged. Review runtime bindings before deploying; `.env` files are not automatically uploaded by copying worker.js.
- The bundle was tested offline in Node with mocked bindings, not deployed or tested against Cloudflare/D1. Visual browser and live conversion-backend checks were not performed.
