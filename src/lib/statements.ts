// Bank statement parsers — FNB statement PDFs and Discovery Bank "Smart Search" Excel exports.
// Both run in the browser; rows go to the pf_import_txns RPC, which de-duplicates and clears pending lines.
import * as XLSX from 'xlsx'
import { pdfTextLines } from './pdfText'

export interface StatementRow { date: string; time?: string; description: string; amount: number; balance?: number; category_id?: number }
export interface Parsed { account: 'FNB' | 'Discovery'; rows: StatementRow[]; period?: string; skipped: number }

const MONTHS: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 }
const MONEY = /^(\d{1,3}(?:,\d{3})*\.\d{2})(Cr|Dr)?$/

/** FNB cheque-account statement: "11 Aug  <description>  100.00  14,775.44Cr [accrued charge]" — credits carry 'Cr'. */
export async function parseFnbPdf(file: File): Promise<Parsed> {
  const { layout, text } = await pdfTextLines(file)
  const pm = text.match(/Statement\s*Period\s*:\s*(\d{1,2})\s*([A-Za-z]+?)\s*(\d{4})\s*to\s*(\d{1,2})\s*([A-Za-z]+?)\s*(\d{4})/)
  if (!pm) throw new Error('No “Statement Period” found — is this an FNB statement PDF?')
  // month → year inside the statement period (a Dec–Jan statement spans two years)
  const monthYear = new Map<number, number>()
  let y = +pm[3], m = MONTHS[pm[2].slice(0, 3)]; const endY = +pm[6], endM = MONTHS[pm[5].slice(0, 3)]
  for (let i = 0; i < 4; i++) { monthYear.set(m, y); if (y > endY || (y === endY && m >= endM)) break; m++; if (m === 13) { m = 1; y++ } }

  const rows: StatementRow[] = []; let skipped = 0
  for (const line of layout) {
    const dm = line.trim().match(/^(\d{1,2})\s*([A-Z][a-z]{2})\s+(.*)$/)
    if (!dm || !MONTHS[dm[2]] || !monthYear.has(MONTHS[dm[2]])) continue
    const toks = dm[3].trim().split(/\s+/); const tail: string[] = []
    while (toks.length && MONEY.test(toks[toks.length - 1]) && tail.length < 3) tail.unshift(toks.pop()!)
    if (tail.length < 2) continue
    const description = toks.join(' ').trim()
    if (!description) { skipped++; continue }            // bank-charge summary lines carry no description
    const am = tail[0].match(MONEY)!, bal = tail[1].match(MONEY)!
    const num = (s: string) => parseFloat(s.replace(/,/g, ''))
    rows.push({
      date: `${monthYear.get(MONTHS[dm[2]])}-${String(MONTHS[dm[2]]).padStart(2, '0')}-${dm[1].padStart(2, '0')}`,
      description, amount: am[2] === 'Cr' ? num(am[1]) : -num(am[1]), balance: bal[2] === 'Cr' ? num(bal[1]) : -num(bal[1]),
    })
  }
  return { account: 'FNB', rows, period: `${pm[1]} ${pm[2]} ${pm[3]} – ${pm[4]} ${pm[5]} ${pm[6]}`, skipped }
}

/** Discovery "Smart Search" export: Value Date, Value Time, Account Nickname, Account Number, Type, Transaction Description,
 *  Beneficiary or Cardholder, Amount, Category, SubCategory, Note. Discovery's own category is passed along as a hint. */
export async function parseDiscoveryXlsx(file: File, hint: (cat: string, sub: string, amount: number) => number | undefined): Promise<Parsed> {
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: false })
  const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true })
  const head = (grid[0] ?? []).map(h => String(h ?? '').toLowerCase())
  const col = (name: string) => head.findIndex(h => h.startsWith(name))
  const c = { date: col('value date'), time: col('value time'), desc: col('transaction description'), amount: col('amount'), cat: col('category'), sub: col('subcategory') }
  if (c.date < 0 || c.desc < 0 || c.amount < 0) throw new Error('This doesn’t look like a Discovery Bank Smart Search export.')
  const rows: StatementRow[] = []; const skipped = 0
  for (const r of grid.slice(1)) {
    if (!r || r[c.date] == null || r[c.amount] == null) continue
    const cat = String(r[c.cat] ?? ''), sub = String(r[c.sub] ?? '')
    const rawDate = r[c.date]
    const date = typeof rawDate === 'number' ? XLSX.SSF.format('yyyy-mm-dd', rawDate) : String(rawDate).slice(0, 10)
    const rawTime = r[c.time]
    const time = typeof rawTime === 'number' ? XLSX.SSF.format('hh:mm:ss', rawTime) : rawTime ? String(rawTime).slice(0, 8) : undefined
    const amount = Math.round(+(r[c.amount] as number) * 100) / 100
    rows.push({ date, time, description: String(r[c.desc] ?? '').trim(), amount, category_id: hint(cat, sub, amount) })
  }
  const dates = rows.map(r => r.date).sort()
  return { account: 'Discovery', rows, period: dates.length ? `${dates[0]} – ${dates[dates.length - 1]}` : undefined, skipped }
}
