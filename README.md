# Kompas

A private household money tracker: every card swipe, slip and debit order in one place, with the focus on
**discretionary spend** — how much is left this month, per day, and where it is leaking.

No financial data lives in this repository. Everything is in Supabase behind row-level security that only
admits people on the household list (`pf_members`).

## What it does

| Screen | |
|---|---|
| **Today** | Discretionary budget ring, rand-per-day left, projected month-end, pace vs last month, where it's going vs your usual, latest activity |
| **Overview** | Income vs expenses, net position, categories over time, fixed vs discretionary, FNB vs Discovery (chart or table) |
| **Categories** | Month → category → sub-category → transactions drill-down, each with a 13-month trend |
| **Transactions** | Search across all months, filters (discretionary / pending / uncategorised), re-categorise once and it is remembered |
| **Slips** | Photograph a till slip; Claude reads merchant, total and line items and ties it to the card payment |
| **Import** | FNB statement PDFs and Discovery "Smart Search" Excel exports, parsed in the browser; safe to re-import |
| **Settings** | Budget, which sub-categories count as discretionary, household members |

## How transactions arrive

1. **Bank e-mails (near real time)** — Discovery Bank's "Transaction update" mails are posted to the `pf-ingest-email`
   edge function (`scripts/ingest-mails.mjs`, a scheduled task, Power Automate, Apps Script — anything that can POST).
   They land as *pending*.
2. **Slips** — `pf-scan-slip` matches the photo to a pending/cleared line of the same amount, or holds a pending line until the bank mail arrives.
3. **Statements** — the monthly import *confirms* pending lines instead of duplicating them and adds everything else (FNB debit orders, salary…).

Descriptions are categorised by learned rules (`pf_rules`): exact match → prefix match (bank mails truncate merchant names) → keyword.

## Stack

Vite + React + TypeScript + Tailwind v4 + Recharts · Supabase (Postgres, Auth, Storage, Edge Functions) · GitHub Pages.

```
supabase/migrations   schema, RLS, import / categorise / match functions (all objects prefixed pf_)
supabase/functions    pf-ingest-email · pf-scan-slip · pf-invite
scripts               apply-schema · deploy-functions · seed · ingest-mails   (secrets in git-ignored scripts/.env)
```

## Setup

```bash
npm install
cp .env.example .env.local        # VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
node scripts/apply-schema.mjs 001_init.sql
node scripts/deploy-functions.mjs pf-ingest-email:public pf-scan-slip pf-invite
npm run dev
```

Edge-function secrets (Supabase dashboard → Edge Functions → Secrets): `ANTHROPIC_API_KEY` (slip reading),
`PF_INGEST_TOKEN` (mail feed), optional `PF_SLIP_MODEL`.

Pushing to `main` deploys to GitHub Pages (repository variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
