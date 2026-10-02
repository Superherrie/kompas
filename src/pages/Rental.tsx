import { useMemo, useState } from 'react'
import { Bar as RBar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useFinance } from '../context/FinanceContext'
import { getTxns, useLoad } from '../lib/data'
import { addMonths, monthLabel, rand0, randK, thisMonth } from '../lib/format'
import { AXIS, Card, GRID, Legend, Tip } from '../components/Charts'
import { TxnList } from '../components/Txns'

const sum = (v: number[]) => v.reduce((s, x) => s + x, 0)
/** SA tax year runs March–February and is named after the year it ends in: Mar 2026–Feb 2027 = "2027" */
const taxYearOf = (m: string) => +m.slice(0, 4) + (+m.slice(5, 7) >= 3 ? 1 : 0)
const taxYearMonths = (y: number) => Array.from({ length: 12 }, (_, i) => addMonths(`${y - 1}-03`, i))

/** The rental property on its own: rent received against what the property costs (bond, levies, rates, utilities),
 *  month by month. Accounting months, like the rest of the app. */
export default function Rental() {
  const { monthly, categories, months: allMonths, reload: reloadFinance } = useFinance()
  const [view, setView] = useState<string>('12')                       // '6' | '12' | 'all' | 'ty2027' …
  const [picked, setPicked] = useState<string>()

  const propertyCat = categories.find(c => c.parent_id === null && c.name === 'Rental Property')
  const rentSub = categories.find(c => c.parent_id !== null && c.name === 'Rental Income')

  const rows = useMemo(() => monthly.filter(r => (r.kind === 'income' && r.sub_name === 'Rental Income') || (r.kind === 'expense' && r.cat_name === 'Rental Property')), [monthly])
  const first = rows.length ? rows.reduce((a, r) => r.month < a ? r.month : a, rows[0].month) : thisMonth()
  const taxYears = useMemo(() => [...new Set(rows.map(r => taxYearOf(r.month)))].sort((a, b) => b - a), [rows])

  const months = useMemo(() => {
    if (view.startsWith('ty')) return taxYearMonths(+view.slice(2)).filter(m => m <= thisMonth())
    if (view === 'all') { const out: string[] = []; for (let m = first; m <= thisMonth(); m = addMonths(m, 1)) out.push(m); return out }
    return Array.from({ length: +view }, (_, i) => addMonths(thisMonth(), i - +view + 1))
  }, [view, first])

  // expense columns = the sub-categories that actually occur (Bond / Mortgage, Levies, Rates & Utilities, …)
  const expSubs = useMemo(() => [...new Set(rows.filter(r => r.kind === 'expense' && months.includes(r.month)).map(r => r.sub_name))].sort(), [rows, months])
  const table = useMemo(() => months.map(m => {
    const r = rows.filter(x => x.month === m)
    const income = r.filter(x => x.kind === 'income').reduce((s, x) => s + x.total, 0)
    const bySub = expSubs.map(s => -r.filter(x => x.kind === 'expense' && x.sub_name === s).reduce((t, x) => t + x.total, 0))
    const expenses = sum(bySub)
    return { m, income: Math.round(income), bySub: bySub.map(Math.round), expenses: Math.round(expenses), net: Math.round(income - expenses) }
  }), [rows, months, expSubs])

  const tot = { income: sum(table.map(t => t.income)), expenses: sum(table.map(t => t.expenses)), bySub: expSubs.map((_, k) => sum(table.map(t => t.bySub[k]))) }
  const n = Math.max(1, table.length)
  const lossMonths = table.filter(t => t.net < 0).length

  const { data: txns, reload } = useLoad(async () => {
    if (!picked || !propertyCat || !rentSub) return []
    const [exp, inc] = await Promise.all([getTxns({ month: picked, catId: propertyCat.id }), getTxns({ month: picked, subId: rentSub.id })])
    return [...inc, ...exp].sort((a, b) => b.txn_date.localeCompare(a.txn_date))
  }, [picked, propertyCat?.id, rentSub?.id])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-3xl md:text-4xl">Rental property</h1>
          <p className="text-sm text-muted mt-1">Rent received against what the property costs, month by month.</p>
        </div>
        <select className="input !w-auto" value={view} onChange={e => { setView(e.target.value); setPicked(undefined) }}>
          <option value="6">Last 6 months</option>
          <option value="12">Last 12 months</option>
          <option value="all">Everything on record</option>
          {taxYears.map(y => <option key={y} value={`ty${y}`}>Tax year {y} (Mar {y - 1} – Feb {y})</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Rent received" value={rand0(tot.income)} hint={`${rand0(tot.income / n)} a month`} />
        <Tile label="Property costs" value={rand0(tot.expenses)} hint={`${rand0(tot.expenses / n)} a month`} />
        <Tile label="Net" value={`${tot.income - tot.expenses < 0 ? '−' : '+'}${rand0(tot.income - tot.expenses)}`} hint={`${rand0((tot.income - tot.expenses) / n)} a month`} bad={tot.income - tot.expenses < 0} />
        <Tile label="Months at a loss" value={`${lossMonths} of ${table.length}`} hint={lossMonths ? 'costs exceeded rent' : 'none'} bad={lossMonths > table.length / 2} />
      </div>

      <Card title="Rent against costs" sub="Tap a month to see its transactions below">
        <Legend items={[{ label: 'Rent received', color: 'var(--s2)' }, { label: 'Property costs', color: 'var(--s1)' }]} />
        <div className="h-60"><ResponsiveContainer>
          <BarChart data={table} barGap={2} margin={{ top: 8, right: 4, left: -8, bottom: 0 }} onClick={e => e?.activeLabel && setPicked(String(e.activeLabel))} style={{ cursor: 'pointer' }}>
            <CartesianGrid {...GRID} /><XAxis dataKey="m" {...AXIS} tickFormatter={m => monthLabel(m, true)} minTickGap={14} /><YAxis {...AXIS} tickFormatter={randK} width={48} />
            <Tooltip content={<Tip labelFormat={monthLabel} />} cursor={{ fill: 'var(--surface-2)' }} />
            <RBar name="Rent received" dataKey="income" fill="var(--s2)" radius={[4, 4, 0, 0]} maxBarSize={16} />
            <RBar name="Property costs" dataKey="expenses" fill="var(--s1)" radius={[4, 4, 0, 0]} maxBarSize={16} />
          </BarChart>
        </ResponsiveContainer></div>
      </Card>

      <Card className="!p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm num min-w-[34rem]">
            <thead>
              <tr className="text-xs text-muted border-b border-line">
                <th className="text-left font-semibold py-2.5 pl-4 pr-2 sticky left-0 bg-surface">Month</th>
                <th className="text-right py-2.5 px-2 whitespace-nowrap">Rent</th>
                {expSubs.map(s => <th key={s} className="text-right py-2.5 px-2">{s}</th>)}
                <th className="text-right py-2.5 px-2 whitespace-nowrap">Total costs</th>
                <th className="text-right py-2.5 pl-2 pr-4">Net</th>
              </tr>
            </thead>
            <tbody>
              {[...table].reverse().map(t => (
                <tr key={t.m} onClick={() => setPicked(picked === t.m ? undefined : t.m)} className={`border-b border-line cursor-pointer hover:bg-surface-2 ${picked === t.m ? 'bg-pine/10' : ''}`}>
                  <td className={`py-2 pl-4 pr-2 font-sans font-medium whitespace-nowrap sticky left-0 ${picked === t.m ? 'bg-surface-2' : 'bg-surface'}`}>{monthLabel(t.m)}{t.m === thisMonth() ? '*' : ''}</td>
                  <td className="text-right px-2 whitespace-nowrap">{t.income ? rand0(t.income) : <span className="text-muted">–</span>}</td>
                  {t.bySub.map((v, k) => <td key={k} className="text-right px-2 whitespace-nowrap text-muted">{v ? rand0(v) : '–'}</td>)}
                  <td className="text-right px-2 whitespace-nowrap">{t.expenses ? rand0(t.expenses) : <span className="text-muted">–</span>}</td>
                  <td className={`text-right pl-2 pr-4 whitespace-nowrap font-semibold ${t.net < 0 ? 'text-bad' : 'text-good'}`}>{t.net < 0 ? '−' : '+'}{rand0(t.net)}</td>
                </tr>
              ))}
              <tr className="bg-surface-2 font-semibold">
                <td className="py-2.5 pl-4 pr-2 font-sans sticky left-0 bg-surface-2">Total</td>
                <td className="text-right px-2 whitespace-nowrap">{rand0(tot.income)}</td>
                {tot.bySub.map((v, k) => <td key={k} className="text-right px-2 whitespace-nowrap">{rand0(v)}</td>)}
                <td className="text-right px-2 whitespace-nowrap">{rand0(tot.expenses)}</td>
                <td className={`text-right pl-2 pr-4 whitespace-nowrap ${tot.income - tot.expenses < 0 ? 'text-bad' : 'text-good'}`}>{tot.income - tot.expenses < 0 ? '−' : '+'}{rand0(tot.income - tot.expenses)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted px-4 py-3">* still running. Rent is what the letting agent paid over (after their fee). Costs are everything filed under Rental Property. Bond interest, not the full instalment, is what counts for tax — this page shows cash paid.</p>
      </Card>

      {picked && (
        <Card title={`${monthLabel(picked)} — transactions`} right={<button className="btn btn-ghost !py-1.5 !text-xs" onClick={() => setPicked(undefined)}>Close</button>}>
          <TxnList txns={txns ?? []} categories={categories} onChanged={() => { void reload(); void reloadFinance() }} dayTotals={false} claimTick={false} />
        </Card>
      )}
      {allMonths.length === 0 && <p className="text-sm text-muted">Loading…</p>}
    </div>
  )
}

function Tile({ label, value, hint, bad }: { label: string; value: string; hint?: string; bad?: boolean }) {
  return <div className="card px-4 py-3"><p className="text-xs text-muted">{label}</p><p className={`display text-2xl num ${bad ? 'text-bad' : ''}`}>{value}</p>{hint && <p className="text-xs text-muted">{hint}</p>}</div>
}
