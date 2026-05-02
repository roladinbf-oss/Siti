# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SITI is a Hebrew-language (RTL) Progressive Web App (PWA) for bakery/food business management — inventory, recipes, production, purchases, sales, labor, and expenses. The frontend is a single static HTML file. The backend is an Express server on Railway that proxies the Anthropic API and exposes a generic CRUD layer over a managed Postgres. There is no Supabase and no Netlify.

## Repository layout

```
.
├── index.html              # Single-file frontend (~7,150 lines, all HTML/CSS/JS inline)
├── sw.js                   # Service Worker (cache-first, /api/* bypassed)
├── manifest.json           # PWA manifest
├── icon.png, icon-512.png  # PWA icons
│
├── server.js               # Express entry: static, /api/scan, /api/<table>, migrations
├── api.js                  # Generic /api/:table CRUD with PostgREST-style query parsing
├── db/
│   ├── index.js            # pg Pool + bigint/numeric → JS number type parsers
│   ├── migrate.js          # Idempotent SQL migration runner (boot-time)
│   ├── migrations/
│   │   └── 0001_init.sql   # Initial schema: 16 tables, indexes, FKs
│   └── legacy_schema.md    # Reference dump of dropped Supabase tables
│
├── package.json            # express + pg
├── Dockerfile              # node:20-alpine, runs `node server.js`
└── CLAUDE.md, .gitignore
```

## Hosting & infra

Everything runs on **Railway** in one project (`Siti`):

- **`siti-eran` service** — Docker build of this repo. Listens on `process.env.PORT` (Railway-injected). Public URL `siti-eran-production.up.railway.app`.
- **Postgres service** — managed plugin. `DATABASE_URL` is referenced into `siti-eran` as a service variable. Connection is internal (Railway private network), no SSL needed.
- **GitHub auto-deploy** — pushing to `main` on `gabik/siti-eran` triggers a build.

Required env vars on `siti-eran`:
- `DATABASE_URL` — referenced from the Postgres service.
- `CLAUDE_API_KEY` — **not yet set**. Until added, `/api/scan` returns `500 "API key not configured"`. The rest of the app works.

There is no staging environment. `production` is the only environment.

## Architecture

### Frontend (`index.html`)

Single file, no framework, no build step. ES6+ with mutable global state. Roughly 27 logical sections separated by `// ═══` banners (search for these to navigate).

Key patterns:

- **DB access goes through four helpers** (around line 1216): `sbGet`, `sbPost`, `sbPatch`, `sbDelete`. The names are kept for historical reasons — they no longer talk to Supabase, they call `/api/<table>` on the same origin. The query syntax (`?col=eq.X&order=name.asc&limit=500`) is preserved end-to-end so call sites didn't have to change. Prefer these helpers over raw `fetch`.

- **Global state** (around line 1234): `INGREDIENTS`, `RECIPES`, `DOUGH_USAGE`, `INGREDIENT_ALIASES`, `SUPPLIERS`, etc. Loaded on page boot, mutated in place by handlers.

- **Ingredient aliasing:** suppliers use different names for the same ingredient. The `ingredient_aliases` table maps `generic_name` (supplier name) → `ingredient_id` (canonical). The AI scan feature uses this to normalise purchased items.

- **RTL / Hebrew:** `dir="rtl"`. All UI text is in Hebrew. Be careful with directional CSS when editing layout — many properties use logical equivalents (`margin-inline-start` etc.).

- **Theme:** dark/light via CSS custom properties; light mode toggled by `body.light-mode`.

### Backend (`server.js` + `api.js` + `db/`)

`server.js` boots in this order:
1. Connect pg Pool (fails fast if `DATABASE_URL` is missing).
2. Run migrations: read every `db/migrations/*.sql` not yet recorded in `_migrations`, apply in a transaction, record the filename. Boot fails if a migration fails.
3. Register routes:
   - `POST /api/scan` — proxies the body to `https://api.anthropic.com/v1/messages` with `CLAUDE_API_KEY`. **Must be registered before `/api/:table` or it gets shadowed.**
   - `GET|POST|PATCH|DELETE /api/:table` — generic CRUD over a whitelisted set of 16 tables.
   - Static files from project root.
   - SPA fallback to `index.html`.

`api.js` parses PostgREST-style queries:

| URL fragment             | SQL                              |
|--------------------------|----------------------------------|
| `?col=eq.X`              | `WHERE "col" = $1`               |
| `?col=gte.X&col=lte.Y`   | `WHERE "col" >= $1 AND "col" <= $2` |
| `?col=in.(a,b,c)`        | `WHERE "col" IN ($1,$2,$3)`      |
| `?col=is.null`           | `WHERE "col" IS NULL`            |
| `?order=name.asc,id.desc`| `ORDER BY "name" ASC, "id" DESC` |
| `?limit=500`             | `LIMIT 500`                      |

All identifiers are validated against `^[a-zA-Z_][a-zA-Z0-9_]*$` and tables against the `TABLES` whitelist. All values are parameterised. Adding a new operator means extending `OP_MAP`. Adding a new table means appending to the `TABLES` set **and** writing a migration.

### Database

Postgres 16. Single `public` schema. 16 tables defined in `db/migrations/0001_init.sql`. The schema mirrors what was on Supabase, minus 6 unused tables (`haccp_lists`, `haccp_logs`, `product_list`, `recipe_aliases`, `suppliers_catalog`, plus a typo'd `Production_logs`) — these are documented in `db/legacy_schema.md` for the day someone wants to revive a dropped feature.

Conventions:

- Most PKs are `bigint generated by default as identity`. Two exceptions (`dough_usage`, `packaging_rules`) use `uuid PRIMARY KEY DEFAULT gen_random_uuid()` because they did on Supabase and changing PK type would change data shape.
- `pg` is configured to coerce `bigint` (OID 20) and `numeric` (OID 1700) to JS numbers, so JSON responses match the Supabase shape that the frontend was built against. Safe for this dataset; row counts and prices are well under `Number.MAX_SAFE_INTEGER`.
- Indexes are added on date columns and common lookup columns (`invoices.inv_num`, `invoices.supplier_name`, etc.).
- The only enforced foreign key is `ingredient_aliases.ingredient_id → ingredients.id` (matching what Supabase declared). Many implicit relationships live inside `jsonb` columns (`sales_log.items[*].recipe_id`, etc.) and cannot be enforced at the schema level.

### Service Worker (`sw.js`)

Cache version is hardcoded as `siti-erp-vNNN`. Bump it whenever `index.html` changes substantively to evict the old cache from existing browsers. The fetch handler skips `/api/*` (live network) and uses network-first / cache-fallback for everything else.

## Migrations workflow

To change the schema:

1. Add a new file `db/migrations/000N_description.sql`. Filenames are sorted lexically — keep the zero-padded numeric prefix.
2. The migration runs once on next boot, in a transaction. If it fails the whole file rolls back and the deploy crashes (intentional — broken schema should not start serving).
3. Migrations are recorded in `_migrations(name PRIMARY KEY)`. Re-running a deploy is a no-op.
4. Migrations are append-only — never edit a file that's been applied to production.

## Development

There is no real local dev story right now. Two options:

- **Frontend-only:** `python -m http.server 8000` against `index.html`. The frontend will hit `/api/*` and get 404s; you only get the static UI. Useful for CSS tweaks.
- **Full stack locally:** install Postgres, set `DATABASE_URL`, `npm install`, `node server.js`. Migrations apply on boot; you get a working clone.

There is no test suite. Verification is manual via browser DevTools (Application → Service Workers, Network).

To "deploy": commit, push to `main`, Railway rebuilds. Bump the SW cache version when shipping non-trivial frontend changes.

## Open items

Two things are still pending. Everything else is done.

1. **File uploads.** `uploadInvoiceFile` in `index.html` is currently a no-op stub that returns `null` and warns to console — invoices save without their attached photo. The plan is a Railway **Volume** mounted into the `siti-eran` service, plus a multipart `POST /api/upload` endpoint in `api.js` that writes into the volume and returns a public URL. Until then, the scan flow still works; only the document attachment is missing.

2. **`CLAUDE_API_KEY`.** Required by `/api/scan` to call Anthropic for receipt extraction. Not yet set on Railway. The first key tried (in chat) was rejected as `invalid x-api-key`. Add it to the `siti-eran` service variables when ready; no redeploy needed, Railway restarts the service on env change.

There is also one open mystery flagged in `db/legacy_schema.md`: the `production_logs` table on Supabase was being written daily but `index.html` has no write path for it. On Railway it will stay empty until whatever process was populating it (manual dashboard? a separate tool?) is identified and either re-pointed or its data re-entered.
