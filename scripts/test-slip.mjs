// Reads one slip photo through the pf-scan-slip function and prints what Claude made of it (nothing is stored).
//   node scripts/test-slip.mjs <photo.jpg>
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
for (const line of existsSync(join(here, '.env')) ? readFileSync(join(here, '.env'), 'utf8').split(/\r?\n/) : []) { const m = line.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }
const t0 = Date.now();
const res = await fetch(`${process.env.SUPABASE_URL}/functions/v1/pf-scan-slip`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ingest-token': process.env.PF_INGEST_TOKEN },
  body: JSON.stringify({ image: readFileSync(process.argv[2]).toString('base64'), media: 'image/jpeg' }),
});
const j = await res.json();
console.log(res.status, `${((Date.now() - t0) / 1000).toFixed(1)}s`, j.model ?? '', j.usage ? `in ${j.usage.input_tokens} / out ${j.usage.output_tokens} tokens` : '');
console.log(JSON.stringify(j.draft ?? j, null, 1));
