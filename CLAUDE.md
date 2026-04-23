# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SITI is a Hebrew-language (RTL) Progressive Web App (PWA) for bakery/food business management — inventory, recipes, production, purchases, sales, labor, and expenses. It runs entirely client-side with Supabase as the database backend and Netlify Functions for AI integration.

## Development

There is no build system. The entire frontend is a single file (`index.html`). To develop locally:

```bash
python -m http.server 8000
# then open http://localhost:8000
```

To deploy: push to git — Netlify auto-deploys. The `CLAUDE_API_KEY` environment variable must be set in the Netlify dashboard for the AI scan feature to work.

There is no test suite. Testing is manual via browser DevTools. The Service Worker can be inspected under Chrome DevTools → Application → Service Workers.

## Architecture

**Single-file frontend (`index.html`, ~7,150 lines):** All HTML, CSS, and JavaScript in one file. JavaScript is organized into ~27 sections separated by `// ═══` banners. There is no framework — plain ES6+ with global state.

**Netlify Function (`netlify/functions/scan.js`):** Thin proxy that forwards POST requests to the Anthropic Claude API. Used for AI-assisted receipt scanning (converts receipt photos/text into structured JSON).

**Database (Supabase/PostgreSQL):** Accessed via REST API directly from the browser using the embedded anon key. Tables include `ingredients`, `recipes`, `purchase_orders`, `products`, `sales`, `labor`, `expenses`, `dough_usage`, `ingredient_aliases`, and more.

**Service Worker (`sw.js`):** Cache-first strategy. Supabase requests are excluded and always fetched fresh. Cache version is hardcoded (e.g., `siti-erp-v221`) — bump this string to force a cache refresh for all users.

## Key Patterns

**Supabase helpers** (around line 1216): All DB access goes through four generic wrappers — `sbGet()`, `sbPost()`, `sbPatch()`, `sbDelete()`. Prefer these over direct fetch calls.

**Global state** (around line 1234): All loaded data lives in uppercase global arrays (`INGREDIENTS`, `RECIPES`, `DOUGH_USAGE`, `INGREDIENT_ALIASES`, etc.). These are populated on page load and mutated in place.

**Ingredient aliasing:** Suppliers use different names for the same ingredient. The `ingredient_aliases` table maps supplier names → canonical ingredient IDs. The AI scan feature relies on this to normalize purchased items.

**RTL / Hebrew:** The app is `dir="rtl"`. All UI text is in Hebrew. CSS uses logical properties where possible; be careful with directional CSS when editing layout.

**Theme:** Dark/light mode via CSS custom properties. Light mode applies via `body.light-mode` class on the `<body>` element.
