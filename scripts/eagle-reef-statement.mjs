// Builds "Eagle Reef Levy Statement - forecast.xlsx": the body-corporate levy account for unit 97 rebuilt from the last
// statement received (Quarto, dated 2026-05-01) + the monthly invoice + payments made per the bank records.
//   node scripts/eagle-reef-statement.mjs "<output folder>"
// ExcelJS comes from the asi-fleet checkout (this PC has no Python / LibreOffice).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
const ExcelJS = createRequire('C:/Users/User1/asi-fleet/package.json')('exceljs');
const env = Object.fromEntries(readFileSync(new URL('./.env', import.meta.url), 'utf8').split(/\r?\n/).map(l => l.match(/^([A-Z_]+)\s*=\s*(.+)$/)).filter(Boolean).map(m => [m[1], m[2].trim()]));
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const outDir = process.argv[2]; if (!outDir) { console.error('usage: node scripts/eagle-reef-statement.mjs <folder>'); process.exit(1); }

// ---- facts from the statement dated 2026-05-01 (Quarto Managing Agent, ref HDE001-D97)
const LEVY = 1421.68, OPENING_CREDIT = 11979.68, STATEMENT_DATE = '2026-05-01', STATEMENT_BALANCE = -6592.96;
const perStatement = [
  ['2026-02-01', 'Invoice', 'INV01856', LEVY, 0],
  ['2026-02-02', 'Payment', 'MAGTAPE CREDIT.ER97 - H DE VRIES', 0, 100],
  ['2026-02-27', 'Payment', 'MAGTAPE CREDIT.ER97 - H DE VRIES', 0, 200],
  ['2026-03-01', 'Invoice', 'INV02037', LEVY, 0],
  ['2026-04-01', 'Invoice', 'INV02212', LEVY, 0],
  ['2026-05-01', 'Invoice', 'INV02336', LEVY, 0],
];
const FORECAST_TO = '2027-02';           // end of the 2027 tax year
const TODAY = new Date().toLocaleDateString('sv');

// ---- payments made, from the bank records (FNB), after the statement date
const { data: bank, error } = await sb.from('pf_v_txns').select('txn_date,description,amount').ilike('description', '%eagle reef levy%').order('txn_date');
if (error) throw new Error(error.message);
const paidAfter = bank.filter(t => t.txn_date > STATEMENT_DATE).map(t => [t.txn_date, -t.amount, t.description]);

// ---- rows after the statement: an invoice on the 1st of every month + the bank payments, in date order
const addMonth = m => { const d = new Date(+m.slice(0, 4), +m.slice(5, 7), 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const later = [];
for (let m = '2026-06'; m <= FORECAST_TO; m = addMonth(m)) later.push({ date: `${m}-01`, kind: 'invoice' });
for (const [date, amount, desc] of paidAfter) later.push({ date, kind: 'paid', amount, desc });
for (let m = addMonth(TODAY.slice(0, 7)); m <= FORECAST_TO; m = addMonth(m)) later.push({ date: `${m}-01`, kind: 'plan' });
later.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'invoice' ? -1 : 1));

const wb = new ExcelJS.Workbook(); wb.creator = 'Kompas';
wb.calcProperties.fullCalcOnLoad = true;      // formulas are recalculated when the file is opened
const FONT = { name: 'Arial', size: 10 };
const BLUE = { ...FONT, color: { argb: 'FF0000FF' } }, BOLD = { ...FONT, bold: true }, GREY = { ...FONT, color: { argb: 'FF666666' } };
const YELLOW = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
const HEAD = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF12332E' } };
const MONEY = '#,##0.00;(#,##0.00);"-"', DATE = 'd mmm yyyy';
const asDate = s => new Date(s + 'T00:00:00Z');

// ============================================================ Statement
const ws = wb.addWorksheet('Statement', { views: [{ state: 'frozen', ySplit: 13 }] });
ws.columns = [{ width: 13 }, { width: 11 }, { width: 44 }, { width: 13 }, { width: 13 }, { width: 14 }, { width: 11 }, { width: 30 }];
const put = (addr, value, font = FONT, extra = {}) => { const c = ws.getCell(addr); c.value = value; c.font = font; Object.assign(c, extra); return c; };

put('A1', 'Eagle Reef Body Corporate — levy account, unit 97', { name: 'Arial', size: 14, bold: true });
put('A2', 'H. De Vries & Erica · reference HDE001-D97 · bank reference "Eagle Reef Levy Er97"', GREY);
put('A3', `Rebuilt ${TODAY} from the last statement received (Quarto Managing Agent, dated 1 May 2026), the monthly invoice and the payments made per the FNB records. The managing agent has since changed — this is a forecast, not their statement.`, GREY);
ws.mergeCells('A3:H3'); ws.getCell('A3').alignment = { wrapText: true, vertical: 'top' }; ws.getRow(3).height = 28;

put('A5', 'Inputs (yellow cells — change these)', BOLD);
put('A6', 'Monthly levy invoice from June 2026'); put('D6', LEVY, BLUE, { numFmt: MONEY, fill: YELLOW });
put('E6', 'Per statement Feb–May 2026: R1,421.68 a month. Assumed unchanged under the new agent — overwrite when their first invoice arrives.', GREY); ws.mergeCells('E6:H6');
put('A7', 'Planned payment each month (forecast rows)'); put('D7', 0, BLUE, { numFmt: MONEY, fill: YELLOW });
put('E7', 'What you intend to pay on the 1st of each future month. 0 = make no further payments.', GREY); ws.mergeCells('E7:H7');

put('A9', 'Where it stands', BOLD);
put('A10', `Balance today (${TODAY})`); put('A11', 'Credit runs out with the invoice of'); put('A12', 'Balance at the end of the forecast');

const H = 13;
['Date', 'Source', 'Description', 'Invoice (Dr)', 'Payment (Cr)', 'Balance', 'Position', 'Basis'].forEach((h, i) => {
  const c = ws.getCell(H, i + 1); c.value = h; c.font = { ...BOLD, color: { argb: 'FFFFFFFF' } }; c.fill = HEAD; c.alignment = { horizontal: i >= 3 && i <= 5 ? 'right' : 'left' };
});

let r = H + 1, bal = -OPENING_CREDIT, todayRow = r, statementRow = 0, lastRow = 0;
const line = (date, source, desc, dr, cr, basis, font = FONT) => {
  const row = ws.getRow(r);
  row.getCell(1).value = asDate(date); row.getCell(1).numFmt = DATE;
  row.getCell(2).value = source; row.getCell(3).value = desc;
  row.getCell(4).value = dr; row.getCell(5).value = cr;
  const d = typeof dr === 'object' ? dr.result : dr, c = typeof cr === 'object' ? cr.result : cr;
  bal = Math.round((bal + d - c) * 100) / 100;
  row.getCell(6).value = r === H + 1 ? { formula: `D${r}-E${r}`, result: bal } : { formula: `F${r - 1}+D${r}-E${r}`, result: bal };
  row.getCell(7).value = { formula: `IF(F${r}>0.005,"Owing",IF(F${r}<-0.005,"In credit","Nil"))`, result: bal > 0.005 ? 'Owing' : bal < -0.005 ? 'In credit' : 'Nil' };
  row.getCell(8).value = basis;
  for (let k = 1; k <= 8; k++) { const cell = row.getCell(k); cell.font = k === 4 || k === 5 ? (typeof cell.value === 'number' && cell.value !== 0 && font === FONT ? BLUE : font) : font; if (k >= 4 && k <= 6) cell.numFmt = MONEY; }
  if (date <= TODAY) todayRow = r;
  lastRow = r; return r++;
};

// opening balance: a credit of 11,979.68 → shown as a payment so the balance formula holds from the first row
bal = 0;
line('2026-02-01', 'Balance b/f', 'Credit balance brought forward', 0, OPENING_CREDIT, 'Statement 1 May 2026');
for (const [date, source, desc, dr, cr] of perStatement) { const row = line(date, source, desc, dr, cr, 'Statement 1 May 2026'); if (date === STATEMENT_DATE) statementRow = row; }
for (const x of later) {
  if (x.kind === 'invoice') line(x.date, 'Invoice', x.date <= TODAY ? 'Monthly levy (invoice not seen — assumed)' : 'Monthly levy — forecast', { formula: '$D$6', result: LEVY }, 0, x.date <= TODAY ? 'Assumed: levy unchanged' : 'Forecast', x.date <= TODAY ? FONT : GREY);
  else if (x.kind === 'paid') line(x.date, 'Payment', x.desc, 0, x.amount, 'FNB bank record');
  else line(x.date, 'Payment', 'Planned payment', 0, { formula: '$D$7', result: 0 }, 'Forecast (input D7)', GREY);
}
for (let k = 1; k <= 8; k++) ws.getCell(lastRow, k).border = { bottom: { style: 'thin' } };

// summary formulas
const F = `F${H + 1}:F${lastRow}`, A = `A${H + 1}:A${lastRow}`;
const balToday = ws.getCell(todayRow, 6).value.result, balEnd = bal;
put('D10', { formula: `F${todayRow}`, result: balToday }, BOLD, { numFmt: MONEY });
put('E10', { formula: `IF(D10>0.005,"owing",IF(D10<-0.005,"in credit","nil"))`, result: balToday > 0.005 ? 'owing' : 'in credit' });
// first row where the balance turns positive (INDEX(…,0) keeps this a plain, non-array formula)
let firstOwing = null; for (let i = H + 1; i <= lastRow; i++) if (ws.getCell(i, 6).value.result > 0.005) { firstOwing = ws.getCell(i, 1).value; break; }
put('D11', { formula: `IFERROR(INDEX(${A},MATCH(TRUE,INDEX(${F}>0.005,0),0)),"not within the forecast")`, result: firstOwing ?? 'not within the forecast' }, BOLD, { numFmt: 'mmm yyyy' });
put('D12', { formula: `F${lastRow}`, result: balEnd }, BOLD, { numFmt: MONEY });
put('E12', { formula: `IF(D12>0.005,"owing",IF(D12<-0.005,"in credit","nil"))`, result: balEnd > 0.005 ? 'owing' : 'in credit' });

// check against the statement's closing balance
const chk = lastRow + 2;
put(`A${chk}`, 'Check', BOLD);
put(`A${chk + 1}`, 'Balance at 1 May 2026 per this sheet'); put(`D${chk + 1}`, { formula: `F${statementRow}`, result: ws.getCell(statementRow, 6).value.result }, FONT, { numFmt: MONEY });
put(`A${chk + 2}`, 'Total due per the statement of 1 May 2026'); put(`D${chk + 2}`, STATEMENT_BALANCE, BLUE, { numFmt: MONEY });
put(`A${chk + 3}`, 'Difference (must be nil)'); put(`D${chk + 3}`, { formula: `ROUND(D${chk + 1}-D${chk + 2},2)`, result: Math.round((ws.getCell(statementRow, 6).value.result - STATEMENT_BALANCE) * 100) / 100 }, BOLD, { numFmt: MONEY });
put(`A${chk + 5}`, 'Balance convention as on the agent’s statement: negative (in brackets) = in credit, positive = owing. Blue = figures typed in from a source; black = formulas.', GREY);
ws.mergeCells(`A${chk + 5}:H${chk + 5}`);

// ============================================================ Bank payments
const wp = wb.addWorksheet('Bank payments');
wp.columns = [{ width: 13 }, { width: 13 }, { width: 58 }, { width: 26 }];
wp.getCell('A1').value = 'Payments to the body corporate per the FNB records (reference “Eagle Reef Levy Er97”)'; wp.getCell('A1').font = { name: 'Arial', size: 12, bold: true };
['Date', 'Amount', 'Bank description', 'On the 1 May 2026 statement?'].forEach((h, i) => { const c = wp.getCell(3, i + 1); c.value = h; c.font = { ...BOLD, color: { argb: 'FFFFFFFF' } }; c.fill = HEAD; });
let pr = 4;
for (const t of bank) {
  const row = wp.getRow(pr++);
  row.getCell(1).value = asDate(t.txn_date); row.getCell(1).numFmt = DATE;
  row.getCell(2).value = -t.amount; row.getCell(2).numFmt = MONEY; row.getCell(2).font = BLUE;
  row.getCell(3).value = t.description;
  row.getCell(4).value = t.txn_date < '2026-02-01' ? 'Before it (in the balance b/f)' : t.txn_date <= STATEMENT_DATE ? 'Yes' : 'No — after the statement';
  [1, 3, 4].forEach(k => row.getCell(k).font = FONT);
}
wp.getCell(pr, 1).value = 'Total'; wp.getCell(pr, 1).font = BOLD;
wp.getCell(pr, 2).value = { formula: `SUM(B4:B${pr - 1})`, result: bank.reduce((s, t) => s - t.amount, 0) }; wp.getCell(pr, 2).numFmt = MONEY; wp.getCell(pr, 2).font = BOLD;
wp.getCell(pr + 2, 1).value = 'Not included (different payees): council rates (ref 303593134) and the utilities account Eree.0097.01 (Alpha Metering / water).'; wp.getCell(pr + 2, 1).font = GREY;
wp.getCell(pr + 3, 1).value = `Source: Kompas transaction data, FNB account, extracted ${TODAY}.`; wp.getCell(pr + 3, 1).font = GREY;

const file = join(outDir, 'Eagle Reef Levy Statement - forecast.xlsx');
await wb.xlsx.writeFile(file);
console.log('written', file);
console.log('rows', lastRow - H, '| balance at statement date', ws.getCell(statementRow, 6).value.result, '(statement says', STATEMENT_BALANCE + ')', '| today', balToday, '| end', balEnd, '| first owing', firstOwing);
console.log('payments after the statement:', JSON.stringify(paidAfter.map(p => [p[0], p[1]])));
