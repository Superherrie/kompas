// Seeds Kompas from the Personal Finances folder's combined_data.json (+ categorization_map.json).
// The data files stay where they are — nothing financial is ever copied into this (public) repo.
//
//   node scripts/seed.mjs "<folder with combined_data.json>" --owner herman@example.com [--apply] [--reset]
//
// Without --apply it only prints what it would load. --reset wipes pf_ transactions/rules/categories first.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const here = dirname(fileURLToPath(import.meta.url));
for (const line of existsSync(join(here, '.env')) ? readFileSync(join(here, '.env'), 'utf8').split(/\r?\n/) : []) {
  const m = line.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const args = process.argv.slice(2);
const folder = args.find(a => !a.startsWith('--'));
const apply = args.includes('--apply'), reset = args.includes('--reset');
const owner = args[args.indexOf('--owner') + 1];
if (!folder || !args.includes('--owner')) { console.error('usage: node scripts/seed.mjs <folder> --owner <email> [--apply] [--reset]'); process.exit(1); }

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const data = JSON.parse(readFileSync(join(folder, 'combined_data.json'), 'utf8'));
const catmap = existsSync(join(folder, 'categorization_map.json')) ? JSON.parse(readFileSync(join(folder, 'categorization_map.json'), 'utf8')) : {};

// Kompas palette (see src/index.css) — one hue per category, sub-categories inherit
const COLORS = {
  'Food and Drink': '#e0694a', 'Recreation': '#8b6fc0', 'Home': '#3f8f6b', 'Transport': '#3d7ea6',
  'Health and Personal Care': '#2fa39a', 'Insurance': '#c98a2b', 'Education': '#5a6fd0', 'Alimony': '#b0506a',
  'Charity': '#d9799b', 'Business': '#7a5ea8', 'Rental Property': '#d08a5a', 'Phone & Internet': '#4aa3c7',
  'External Savings and Investments': '#5fa85a', 'Fees and Interest': '#a8534a', 'Clothing': '#e2b04a',
  'Miscellaneous': '#8a8f87', 'Personal Allowances': '#6fa5a0', 'Personal Loans': '#b9773a', 'Cash': '#77806f',
  'Uncategorised': '#a7aaa2', 'Income': '#2f7d5b', 'Transfers': '#9aa19a',
};
// what counts as discretionary to start with (editable in Settings → Categories)
const DISCRETIONARY = new Set([
  'Food and Drink > Eating Out and Takeouts', 'Food and Drink > Coffee', 'Food and Drink > Alcohol',
  'Recreation > *', 'Clothing > *', 'Cash > Withdrawal', 'Uncategorised > Uncategorised',
  'Health and Personal Care > Hair and Beauty', 'Health and Personal Care > Health Products',
  'Home > Electronics', 'Home > Homeware', 'Home > Gardening', 'Home > Other', 'Home > Home Improvement',
  'Transport > Taxi', 'Transport > Car Wash', 'Transport > Parking', 'Transport > Flights', 'Transport > Vehicle Rental',
  'Miscellaneous > *',
]);
const NOT_DISCRETIONARY = new Set(['Recreation > TV', 'Recreation > Subscriptions', 'Miscellaneous > Memberships']);
const isDisc = (c, s) => !NOT_DISCRETIONARY.has(`${c} > ${s}`) && (DISCRETIONARY.has(`${c} > ${s}`) || DISCRETIONARY.has(`${c} > *`));

// ---- categories
const pairs = new Map();   // 'Cat > Sub' -> {cat, sub, kind}
const add = (cat, sub, kind = 'expense') => pairs.set(`${cat} > ${sub}`, { cat, sub, kind });
for (const t of data.transactions) add(t.Category, t.SubCategory, t.Category === 'Income' ? 'income' : 'expense');
for (const v of Object.values(catmap)) if (Array.isArray(v) && v[0] && v[1]) add(v[0], v[1], v[0] === 'Income' ? 'income' : 'expense');
add('Uncategorised', 'Uncategorised'); add('Transfers', 'Between own accounts', 'transfer'); add('Transfers', 'Savings pockets', 'transfer');
const cats = [...new Set([...pairs.values()].map(p => p.cat))].sort();
console.log(`${cats.length} categories, ${pairs.size} sub-categories, ${data.transactions.length} transactions`);
console.log('discretionary:', [...pairs.values()].filter(p => p.kind === 'expense' && isDisc(p.cat, p.sub)).map(p => `${p.cat} > ${p.sub}`).join('; '));
if (!apply) { console.log('\n(dry run — add --apply to load)'); process.exit(0); }

const must = async (p, what) => { const { data: d, error } = await p; if (error) { console.error(what, error.message); process.exit(1); } return d; };

// ---- owner
const users = await must(sb.auth.admin.listUsers({ perPage: 1000 }), 'list users');
const u = users.users.find(x => x.email?.toLowerCase() === owner.toLowerCase());
if (!u) { console.error(`no login for ${owner} in this Supabase project`); process.exit(1); }
await must(sb.from('pf_members').upsert({ user_id: u.id, display_name: 'Herman', email: owner.toLowerCase(), role: 'owner' }), 'member');

if (reset) {
  await must(sb.from('pf_transactions').delete().gt('id', 0), 'reset txns');
  await must(sb.from('pf_rules').delete().gt('id', 0), 'reset rules');
  await must(sb.from('pf_categories').delete().gt('id', 0), 'reset categories');
}

// ---- accounts
await must(sb.from('pf_accounts').upsert([
  { name: 'FNB', bank: 'FNB Fusion Private Wealth', purpose: 'Salary, debit orders and monthly payments', card_last4: [], color: '#1f6f78', sort: 1 },
  { name: 'Discovery', bank: 'Discovery Bank', purpose: 'Daily spend + Discovery debit orders', card_last4: ['5302'], color: '#e0694a', sort: 2 },
], { onConflict: 'name' }), 'accounts');
const accounts = Object.fromEntries((await must(sb.from('pf_accounts').select('id,name'), 'accounts')).map(a => [a.name, a.id]));

// ---- categories (parents, then subs)
let existing = await must(sb.from('pf_categories').select('id,parent_id,name'), 'cats');
const parentId = name => existing.find(c => c.parent_id === null && c.name === name)?.id;
const newParents = cats.filter(c => !parentId(c)).map((name, i) => ({
  name, color: COLORS[name] ?? '#8a8f87', sort: i,
  kind: name === 'Income' ? 'income' : name === 'Transfers' ? 'transfer' : 'expense',
}));
if (newParents.length) await must(sb.from('pf_categories').insert(newParents), 'insert categories');
existing = await must(sb.from('pf_categories').select('id,parent_id,name'), 'cats');
const newSubs = [...pairs.values()].filter(p => !existing.find(c => c.parent_id === parentId(p.cat) && c.name === p.sub))
  .map(p => ({ parent_id: parentId(p.cat), name: p.sub, kind: p.kind, discretionary: p.kind === 'expense' && isDisc(p.cat, p.sub) }));
if (newSubs.length) await must(sb.from('pf_categories').insert(newSubs), 'insert sub-categories');
existing = await must(sb.from('pf_categories').select('id,parent_id,name'), 'cats');
const subId = (cat, sub) => existing.find(c => c.parent_id === parentId(cat) && c.name === sub)?.id;

// ---- rules: what each description was categorised as (most frequent wins), then the older map for anything else
const votes = new Map();
for (const t of data.transactions) {
  if (t.Category === 'Uncategorised') continue;
  const k = norm(t.Description); if (!k) continue;
  const id = subId(t.Category, t.SubCategory); const m = votes.get(k) ?? new Map(); m.set(id, (m.get(id) ?? 0) + 1); votes.set(k, m);
}
const rules = new Map();
for (const [k, m] of votes) rules.set(k, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]);
for (const [key, v] of Object.entries(catmap)) {
  if (!Array.isArray(v) || v[0] === 'Uncategorised') continue;
  const k = key.split('|')[1]; const id = subId(v[0], v[1]);
  if (k && id && !rules.has(k)) rules.set(k, id);
}
// stable references whose trailing numbers change every month
const CONTAINS = [['discbank', 'Transfers', 'Between own accounts'], ['disclife', 'Insurance', 'Life Insurance'], ['discinsure', 'Insurance', 'Short Term Insurance'],
  ['glacier', 'External Savings and Investments', 'Investments'], ['discinvt', 'External Savings and Investments', 'Investments'], ['virginact', 'Recreation', 'Sport and Fitness']];
const ruleRows = [...rules].map(([pattern, category_id]) => ({ pattern, match: 'exact', category_id }));
for (const [pattern, c, s] of CONTAINS) { add(c, s); const id = subId(c, s); if (id) ruleRows.push({ pattern, match: 'contains', category_id: id }); }
const { count: ruleCount } = await sb.from('pf_rules').select('id', { count: 'exact', head: true });
if (ruleCount) console.log(`pf_rules already holds ${ruleCount} rows — skipped`);
else {
  for (let i = 0; i < ruleRows.length; i += 500) await must(sb.from('pf_rules').insert(ruleRows.slice(i, i + 500)), 'rules');
  console.log(`${ruleRows.length} rules`);
}

// ---- transactions (only when the table is empty — re-seeding would duplicate)
const { count } = await sb.from('pf_transactions').select('id', { count: 'exact', head: true });
if (count) console.log(`pf_transactions already holds ${count} rows — skipped (use --reset to reload)`);
else {
  const rows = data.transactions.map(t => ({
    account_id: accounts[t.Account], txn_date: t.Date, description: t.Description, amount: t.Amount,
    category_id: subId(t.Category, t.SubCategory), source: 'seed', status: 'cleared',
  }));
  for (let i = 0; i < rows.length; i += 500) await must(sb.from('pf_transactions').insert(rows.slice(i, i + 500)), `txns ${i}`);
  console.log(`${rows.length} transactions loaded`);
}

// ---- starting budget: 85% of the last six full months' average discretionary spend, rounded to R500
const months = data.months.slice(-7, -1);
const disc = data.transactions.filter(t => months.includes(t.Month) && t.Category !== 'Income' && isDisc(t.Category, t.SubCategory)).reduce((s, t) => s - t.Amount, 0) / months.length;
const budget = Math.round(disc * 0.85 / 500) * 500;
await must(sb.from('pf_settings').upsert([{ key: 'discretionary_budget', value: String(budget) }], { onConflict: 'key', ignoreDuplicates: true }), 'settings');
console.log(`average discretionary R${Math.round(disc)} / month → starting budget R${budget}`);
