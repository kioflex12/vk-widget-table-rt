# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **VK Mini App** that renders a game leaderboard ("Итоговая таблица RT"). It is a static site — three files (`index.html`, `app.js`, `styles.css`), no build step, no package manager, no tests, no backend. `data.json` is empty and unused. Deployed via **GitHub Pages** (repo `kioflex12/vk-widget-table-rt`); the live URL is what VK loads as the mini app.

## Commands

There is no build/lint/test tooling. To iterate:

- **Serve locally:** any static server from the repo root, e.g. `python -m http.server 8000`. Opening `index.html` renders the public table, but the admin flow and VK Bridge calls only work when launched inside VK with real launch params.
- **Deploy:** commit + push to `main`; GitHub Pages serves it.

## Release convention (IMPORTANT)

On **every commit**, bump the cache-busting versions so users get the new code (GitHub Pages caches aggressively):

1. Increment the **patch** digit of `VERSION` in [app.js](app.js) (~line 10), e.g. `1.0.6` → `1.0.7`. Patch only — never minor/major. This value shows in the admin UI version pill so the user can confirm the deploy landed.
2. Update the `?v=...` query strings on the `styles.css` and `app.js` `<script>`/`<link>` tags in [index.html](index.html).

## Tooling (`.claude/`)

Ported and adapted from the larger `vibecode` monorepo, trimmed to this project's reality (no RAG/Jira/statics/C# — just local code + web).

- **`/consilium`** — before giving any non-trivial recommendation, bug-cause hypothesis, or design decision, run it through a board of advisors. Spawns `advisor-skeptic` + `advisor-engineer` + a **quality-gate** (always), plus `advisor-pragmatist` / `advisor-user-advocate` / `advisor-visionary` by relevance, in parallel. If the board rejects the hypothesis, don't ship the recommendation. Advisors investigate the **local code** (Read/Grep/Glob/git) and external APIs via WebFetch/WebSearch — they have no vibecode MCP access. Quality bar for changes lives in [.claude/skills/consilium/quality-rubric.md](.claude/skills/consilium/quality-rubric.md) (root-cause fix, XSS/escaping, no committed secrets, CSV robustness, VK-widget contract, the version-bump release invariant).
- **`/google-sheets`** — for the "auto-fill the sheet" goal: gspread + google-auth, the service-account path for unattended writes, and how writes line up with the widget's published-CSV read layer. See [.claude/skills/google-sheets/SKILL.md](.claude/skills/google-sheets/SKILL.md).
- **Advisor personas** live in [.claude/agents/](.claude/agents/) (`model: sonnet` for model diversity / cost); they're also usable standalone for a quick critique.
- **[.claude/rules/working-practices.md](.claude/rules/working-practices.md)** — when to run the council, how to delegate to subagents with precise anchors, keeping the main context small, and the release/secret invariants.

## Architecture

**Two view modes, chosen at runtime by VK launch params** (`init()` in [app.js](app.js)):

- No `vk_group_id` in the URL → **public view** (`#publicView`): read-only leaderboard for normal users. This is the default so mobile users never hit a white screen.
- `vk_group_id` present (admin opened the app from their community) → **admin view** (`#adminView`): a 3-step panel to push the widget to the community.

**Data source is a published Google Sheet, read as CSV** — there is no server. The `PUB_ID` + `SHEET_GID` constants build a `.../pub?output=csv` URL (`csvUrl()`). Expected columns: **A = Nick, B = VK (link or shortname), C = RT (score)**. A hand-rolled CSV parser (`parseCsv`) handles quoting/commas/newlines; `parseRows` skips an optional header row and assigns 1-based `place`. Public view shows all rows; the VK widget is capped at `LIMIT` (10).

**Admin → widget flow** (3 buttons, admin view only):
1. `VKWebAppGetCommunityAuthToken` (scope `app_widget`) → community access token.
2. Load + parse the sheet.
3. `buildWidgetObject()` produces a VK `table` widget object → `buildCode()` wraps it as `return {...};` → sent via `VKWebAppCallAPIMethod` calling `appWidgets.update`. Direct `fetch` to the VK API is avoided intentionally (CORS) — always go through VK Bridge.

**VK Bridge** is loaded from the unpkg CDN in [index.html](index.html). `init()` fires `VKWebAppInit` but deliberately does **not** await it (awaiting blocked data loading on some clients); code guards against `window.vkBridge` being undefined.

**Player links:** `buildProfileUrl()` accepts a bare VK shortname (→ `https://vk.com/<name>`) or a full URL, but only allows the domains in `VK_DOMAINS`; non-VK URLs are dropped so the widget/table never links off-platform.

## Gotchas

- The whole app is wrapped in a `window.__RT_WIDGET_APP_LOADED__` guard to survive double-injection.
- All user-facing strings and most comments are in Russian — match that when editing UI text.
- Top-3 rows get medal emojis and gradient row styling (`place-1/2/3`) driven by the `place` value.
