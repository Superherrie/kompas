// Load bank statements from the command line — the same parsing and the same pf_import_txns RPC as the app's Import page,
// for when the files are on this PC rather than the phone.
//   node scripts/import-statements.mjs [--dry] <file.pdf|file.xlsx> ...
// --dry parses and compares against the database without writing anything.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const env = Object.fromEntries(readFileSync(new URL('./.env', import.meta.url), 'utf8').split(/\r?\n/).map(l => l.match(/^([A-Z_]+)\s*=\s*(.+)$/)).filter(Boolean).map(m => [m[1], m[2].trim()]));
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const args = process.argv.slice(2); const dry = args.includes('--dry'); const files = args.filter(a => a !== '--dry');
if (!files.length) { console.error('usage: node scripts/import-statements.mjs [--dry] <files>'); process.exit(1); }

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const MONEY = /^(\d{1,3}(?:,\d{3})*\.\d{2})(Cr|Dr)?$/;
const norm = t => String(t ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const num = s => parseFloat(s.replace(/,/g, ''));

/** pdfjs items grouped into lines by vertical position, columns padded — mirrors src/lib/pdfText.ts */
async function pdfLayoutLines(path) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), useSystemFonts: true }).promise;
  const layout = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    const items = content.items.filter(it => 'str' in it).map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width }));
    const bands = new Map();
    for (const it of items) { const key = [...bands.keys()].find(k => Math.abs(k - it.y) <= 3) ?? it.y; (bands.get(key) ?? bands.set(key, []).get(key)).push(it); }
    for (const key of [...bands.keys()].sort((a, b) => b - a)) {
      const row = bands.get(key).sort((a, b) => a.x - b.x);
      let s = '', cursor = 0;
      for (const it of row) { const gap = it.x - cursor; s += (gap > 12 ? '   ' : s ? ' ' : '') + it.str; cursor = it.x + it.w; }
      layout.push(s);
    }
  }
  return layout;
}

async function parseFnbPdf(path) {
  const layout = await pdfLayoutLines(path); const text = layout.join('\n');
  const pm = text.match(/Statement\s*Period\s*:\s*(\d{1,2})\s*([A-Za-z]+?)\s*(\d{4})\s*to\s*(\d{1,2})\s*([A-Za-z]+?)\s*(\d{4})/);
  if (!pm) throw new Error('No "Statement Period" found — is this an FNB statement PDF?');
  const monthYear = new Map(); let y = +pm[3], m = MONTHS[pm[2].slice(0, 3)]; const endY = +pm[6], endM = MONTHS[pm[5].slice(0, 3)];
  for (let i = 0; i < 4; i++) { monthYear.set(m, y); if (y > endY || (y === endY && m >= endM)) break; m++; if (m === 13) { m = 1; y++; } }
  const rows = []; let skipped = 0;
  for (const line of layout) {
    const dm = line.trim().match(/^(\d{1,2})\s*([A-Z][a-z]{2})\s+(.*)$/);
    if (!dm || !MONTHS[dm[2]] || !monthYear.has(MONTHS[dm[2]])) continue;
    const toks = dm[3].trim().split(/\s+/); const tail = [];
    while (toks.length && MONEY.test(toks[toks.length - 1]) && tail.length < 3) tail.unshift(toks.pop());
    if (tail.length < 2) continue;
    // the PDF's font splits "W" from the rest of the word ("W isdom", "W oolworths")
    const description = toks.join(' ').replace(/\bW (?=[a-z])/g, 'W').trim();
    if (!description) { skipped++; continue; }
    const am = tail[0].match(MONEY), bal = tail[1].match(MONEY);
    rows.push({ date: `${monthYear.get(MONTHS[dm[2]])}-${String(MONTHS[dm[2]]).padStart(2, '0')}-${dm[1].padStart(2, '0')}`,
      description, amount: am[2] === 'Cr' ? num(am[1]) : -num(am[1]), balance: bal[2] === 'Cr' ? num(bal[1]) : -num(bal[1]) });
  }
  return { account: 'FNB', rows, period: `${pm[1]} ${pm[2]} ${pm[3]} – ${pm[4]} ${pm[5]} ${pm[6]}`, skipped };
}

function parseDiscoveryXlsx(path, hint) {
  const wb = XLSX.read(readFileSync(path), { cellDates: false });
  const grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true });
  const head = (grid[0] ?? []).map(h => String(h ?? '').toLowerCase());
  const col = name => head.findIndex(h => h.startsWith(name));
  const c = { date: col('value date'), time: col('value time'), desc: col('transaction description'), amount: col('amount'), cat: col('category'), sub: col('subcategory') };
  if (c.date < 0 || c.desc < 0 || c.amount < 0) throw new Error('Not a Discovery Bank Smart Search export.');
  const rows = [];
  for (const r of grid.slice(1)) {
    if (!r || r[c.date] == null || r[c.amount] == null) continue;
    const rawDate = r[c.date], rawTime = r[c.time];
    const date = typeof rawDate === 'number' ? XLSX.SSF.format('yyyy-mm-dd', rawDate) : String(rawDate).slice(0, 10);
    const time = typeof rawTime === 'number' ? XLSX.SSF.format('hh:mm:ss', rawTime) : rawTime ? String(rawTime).slice(0, 8) : undefined;
    const amount = Math.round(+r[c.amount] * 100) / 100;
    rows.push({ date, time, description: String(r[c.desc] ?? '').trim(), amount, category_id: hint(String(r[c.cat] ?? ''), String(r[c.sub] ?? ''), amount) });
  }
  const dates = rows.map(r => r.date).sort();
  return { account: 'Discovery', rows, period: dates.length ? `${dates[0]} – ${dates[dates.length - 1]}` : undefined, skipped: 0 };
}

const { data: categories } = await sb.from('pf_categories').select('id,name,parent_id,kind');
const hint = (cat, sub, amount) => {
  if (cat === 'Not for Financial Analyser') return categories.find(c => c.name === 'Savings pockets')?.id;
  const parent = categories.find(c => c.parent_id === null && c.name === cat);
  const hit = categories.find(c => c.parent_id === parent?.id && c.name === sub);
  return hit && hit.name !== 'Uncategorised' && (amount < 0) === (hit.kind === 'expense') ? hit.id : undefined;
};

for (const path of files) {
  const parsed = /\.pdf$/i.test(path) ? await parseFnbPdf(path) : parseDiscoveryXlsx(path, hint);
  console.log(`\n== ${basename(path)} → ${parsed.account}, ${parsed.rows.length} lines, ${parsed.period}${parsed.skipped ? `, ${parsed.skipped} skipped` : ''}`);
  const dates = parsed.rows.map(r => r.date).sort(); const from = dates[0], to = dates[dates.length - 1];
  const { data: acc } = await sb.from('pf_accounts').select('id').ilike('name', parsed.account).single();
  const { data: have } = await sb.from('pf_transactions').select('id,txn_date,txn_time,description,amount,status,source,norm')
    .eq('account_id', acc.id).gte('txn_date', new Date(Date.parse(from) - 6 * 864e5).toISOString().slice(0, 10)).lte('txn_date', to);
  // the same tests pf_import_txns applies, so the preview says what the import will do
  const seen = new Set(); const verdicts = { known: [], pending: [], new: [] };
  for (const r of parsed.rows) {
    const n40 = norm(r.description).slice(0, 40);
    const cleared = have.find(x => !seen.has(x.id) && x.status === 'cleared' && x.txn_date === r.date && +x.amount === r.amount && x.norm.slice(0, 40) === n40);
    if (cleared) { seen.add(cleared.id); verdicts.known.push(r); continue; }
    const pend = have.filter(x => !seen.has(x.id) && x.status === 'pending' && +x.amount === r.amount && Date.parse(x.txn_date) >= Date.parse(r.date) - 5 * 864e5 && Date.parse(x.txn_date) <= Date.parse(r.date) + 864e5)
      .sort((a, b) => Math.abs(Date.parse(a.txn_date) - Date.parse(r.date)) - Math.abs(Date.parse(b.txn_date) - Date.parse(r.date)))[0];
    if (pend) { seen.add(pend.id); verdicts.pending.push({ ...r, was: pend }); continue; }
    verdicts.new.push(r);
  }
  console.log(`   already loaded ${verdicts.known.length} · confirms a mail/slip line ${verdicts.pending.length} · NEW ${verdicts.new.length}`);
  for (const r of verdicts.new) console.log('   + NEW', r.date, String(r.amount).padStart(10), r.description);
  // bank-mail lines in the statement window that the statement does not show
  const orphans = have.filter(x => x.status === 'pending' && !seen.has(x.id) && x.txn_date >= from && x.txn_date <= to);
  for (const x of orphans) console.log('   ? pending, not on statement:', x.txn_date, String(x.amount).padStart(10), x.description, `(${x.source})`);
  if (dry) continue;
  const { data, error } = await sb.rpc('pf_import_txns', { p_account: parsed.account, p_source: 'statement', p_rows: parsed.rows });
  if (error) { console.error('   IMPORT FAILED:', error.message); continue; }
  console.log('   imported:', JSON.stringify(data));
}
