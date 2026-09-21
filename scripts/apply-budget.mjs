// Loads the household budget workbook ("Budget vs History" sheet) into Kompas:
//   - the Discretionary Yes/No column sets pf_categories.discretionary for every sub-category of that category
//   - "Monthly Budget (R)" and the month columns after it become pf_budgets rows (category × month)
//   - pf_settings.discretionary_budget = sum of the discretionary categories' monthly budget
//   node scripts/apply-budget.mjs "<Budget_Income_Statement_….xlsx>" --start 2026-09 [--apply]
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createClient } from '@supabase/supabase-js';
const XLSX = createRequire(import.meta.url)('xlsx');
const here = dirname(fileURLToPath(import.meta.url));
for (const line of existsSync(join(here, '.env')) ? readFileSync(join(here, '.env'), 'utf8').split(/\r?\n/) : []) { const m = line.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }
const args = process.argv.slice(2); const file = args.find(a => !a.startsWith('--') && a.endsWith('.xlsx')); const apply = args.includes('--apply');
const start = args[args.indexOf('--start') + 1];
if (!file || !/^\d{4}-\d{2}$/.test(start ?? '')) { console.error('usage: node scripts/apply-budget.mjs <workbook.xlsx> --start YYYY-MM [--apply]'); process.exit(1); }

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const grid = XLSX.utils.sheet_to_json(XLSX.read(readFileSync(file)).Sheets['Budget vs History'], { header: 1, raw: true, defval: null });
const h = grid.findIndex(r => r?.[0] === 'Line item'); const head = grid[h];
const cBudget = head.findIndex(x => /^Monthly Budget/i.test(x ?? '')), cDisc = head.indexOf('Discretionary');
// month columns after the budget column: bare month names, rolling forward from --start
const monthCols = []; let [y, m] = start.split('-').map(Number);
monthCols.push({ col: cBudget, month: start });
for (let c = cBudget + 1; c < head.length; c++) { const i = MON.indexOf(String(head[c] ?? '').slice(0, 3)); if (i < 0 || c === cDisc) continue; if (i + 1 <= m) y++; m = i + 1; monthCols.push({ col: c, month: `${y}-${String(m).padStart(2, '0')}` }); }

// the sheet's last expense line bundles the small categories
const ALIAS = { 'Other categories (cash, loans, alimony-adj, etc.)': ['Cash', 'Personal Loans'] };
const from = grid.findIndex(r => r?.[0] === 'EXPENSES'), to = grid.findIndex(r => r?.[0] === 'TOTAL EXPENSES');
const lines = grid.slice(from + 1, to).filter(r => r?.[0]).map(r => ({
  names: ALIAS[r[0]] ?? [r[0]], disc: String(r[cDisc] ?? '').toLowerCase() === 'yes',
  budgets: monthCols.map(({ col, month }, i) => ({ month, amount: r[col] ?? (i === 0 ? 0 : null) })), note: r[head.indexOf('Notes')] ?? null,
}));
// a blank month cell after an explicit figure means nothing planned that month (e.g. Education Nov/Dec) — but only when the row has month-specific figures at all
for (const l of lines) { const varies = l.budgets.slice(1).some(b => b.amount !== null && b.amount !== l.budgets[0].amount); l.budgets = l.budgets.map(b => ({ ...b, amount: b.amount ?? (varies ? 0 : l.budgets[0].amount) })); }

const discBudget = lines.filter(l => l.disc).reduce((s, l) => s + l.budgets[0].amount, 0);
console.table(lines.map(l => ({ category: l.names.join(' + '), discretionary: l.disc ? 'YES' : 'no', ...Object.fromEntries(l.budgets.map(b => [b.month, b.amount])) })));
console.log(`Discretionary budget: R${discBudget}`);
if (!apply) { console.log('(dry run — add --apply)'); process.exit(0); }

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = async (p, what) => { const { data, error } = await p; if (error) { console.error(what, error.message); process.exit(1); } return data; };
const cats = await must(sb.from('pf_categories').select('id,name,parent_id,kind'), 'categories');
const rows = [];
for (const l of lines) for (const name of l.names) {
  const parent = cats.find(c => c.parent_id === null && c.name === name);
  if (!parent) { console.warn(`! no category called "${name}" — skipped`); continue; }
  await must(sb.from('pf_categories').update({ discretionary: l.disc }).eq('parent_id', parent.id), name);
  // a bundled line's budget sits on its first category only
  for (const b of l.budgets) rows.push({ category_id: parent.id, month: b.month, amount: name === l.names[0] ? Math.round(b.amount * 100) / 100 : 0, note: l.note });
  await must(sb.from('pf_categories').update({ budget: name === l.names[0] ? l.budgets[0].amount : 0 }).eq('id', parent.id), name);
}
await must(sb.from('pf_budgets').upsert(rows), 'budgets');
await must(sb.from('pf_settings').upsert({ key: 'discretionary_budget', value: String(Math.round(discBudget)) }), 'setting');
console.log(`Applied: ${rows.length} budget rows, discretionary flags on ${lines.length} lines, discretionary budget R${Math.round(discBudget)}`);
