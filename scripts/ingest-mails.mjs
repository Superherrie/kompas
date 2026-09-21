// Posts Discovery "Transaction update" mails to the pf-ingest-email function.
//   node scripts/ingest-mails.mjs mails.json [--dry]
// mails.json = [{ "id": "<internetMessageId>", "sent": "2026-09-21T06:02:23Z", "text": "Card payment … Available balance: R …" }]
// Used by the scheduled mail-sync task; the ingest token lives in the git-ignored scripts/.env.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
for (const line of existsSync(join(here, '.env')) ? readFileSync(join(here, '.env'), 'utf8').split(/\r?\n/) : []) { const m = line.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }
const file = process.argv[2]; if (!file) { console.error('usage: node scripts/ingest-mails.mjs mails.json [--dry]'); process.exit(1); }
const messages = JSON.parse(readFileSync(file, 'utf8'));
const res = await fetch(`${process.env.SUPABASE_URL}/functions/v1/pf-ingest-email`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ingest-token': process.env.PF_INGEST_TOKEN },
  body: JSON.stringify({ messages, dry_run: process.argv.includes('--dry') }),
});
console.log(res.status, JSON.stringify(await res.json(), null, 1));
if (!res.ok) process.exit(1);
