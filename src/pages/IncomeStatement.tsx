import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useFinance } from '../context/FinanceContext'
import { addMonths, monthLabel, rand0, thisMonth } from '../lib/format'
import { Card } from '../components/Charts'
import Icon from '../components/Icon'

type Row = { id: number; name: string; disc?: boolean; vals: number[] }
type Block = { id: number; name: string; color: string | null; vals: number[]; budget?: number; subs: Row[] }
const sum = (v: number[]) => v.reduce((s, x) => s + x, 0)

/** The month-by-month income statement: income by source, expenses by category (expand for sub-categories),
 *  net for the month. Accounting months (month-end FNB payments count in the next month). Transfers and work
 *  claims are left out — they are not income or spend. */
export default function IncomeStatement() {
  const { monthly, budgetFor } = useFinance()
  const [span, setSpan] = useState(6)
  const [endMonth, setEndMonth] = useState(thisMonth())
  const [open, setOpen] = useState<Set<number>>(new Set())
  const months = useMemo(() => Array.from({ length: span }, (_, i) => addMonths(endMonth, i - span + 1)), [endMonth, span])

  const { income, expense, totals } = useMemo(() => {
    const build = (kind: 'income' | 'expense') => {
      const m = new Map<number, Block>()
      for (const r of monthly) {
        if (r.kind !== kind) continue
        const k = months.indexOf(r.month); if (k < 0) continue
        const b = m.get(r.cat_id) ?? { id: r.cat_id, name: r.cat_name, color: r.color, vals: months.map(() => 0), subs: [] }
        let s = b.subs.find(x => x.id === r.sub_id)
        if (!s) { s = { id: r.sub_id, name: r.sub_name, disc: r.discretionary, vals: months.map(() => 0) }; b.subs.push(s) }
        const v = kind === 'expense' ? -r.total : r.total
        b.vals[k] += v; s.vals[k] += v
        m.set(r.cat_id, b)
      }
      const blocks = [...m.values()].filter(b => b.vals.some(v => Math.abs(v) >= 0.5))
      for (const b of blocks) { b.subs.sort((a, c) => sum(c.vals) - sum(a.vals)); b.budget = kind === 'expense' ? budgetFor(b.id, months[months.length - 1]) : undefined }
      return blocks.sort((a, b) => sum(b.vals) - sum(a.vals))
    }
    const income = build('income'), expense = build('expense')
    const tot = (bs: Block[]) => months.map((_, k) => bs.reduce((s, b) => s + b.vals[k], 0))
    const ti = tot(income), te = tot(expense)
    const disc = months.map((_, k) => expense.reduce((s, b) => s + b.subs.filter(x => x.disc).reduce((t, x) => t + x.vals[k], 0), 0))
    return { income, expense, totals: { income: ti, expense: te, disc, net: ti.map((v, k) => v - te[k]) } }
  }, [monthly, months, budgetFor])

  const toggle = (id: number) => setOpen(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const avg = (vals: number[]) => sum(vals) / Math.max(1, vals.length)

  const csv = () => {
    const lines: string[][] = [['Line', ...months.map(m => monthLabel(m)), 'Average']]
    const put = (name: string, vals: number[], indent = 0) => lines.push([`${'  '.repeat(indent)}${name}`, ...vals.map(v => v.toFixed(2)), avg(vals).toFixed(2)])
    lines.push(['INCOME']); for (const b of income) { put(b.name, b.vals); for (const s of b.subs) put(s.name, s.vals, 1) }
    put('Total income', totals.income)
    lines.push(['EXPENSES']); for (const b of expense) { put(b.name, b.vals); for (const s of b.subs) put(s.name, s.vals, 1) }
    put('Total expenses', totals.expense); put('of which discretionary', totals.disc); put('NET', totals.net)
    const blob = new Blob([lines.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `kompas-income-statement-${months[0]}-to-${months[months.length - 1]}.csv`; a.click()
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-3xl md:text-4xl">Income statement</h1>
          <p className="text-sm text-muted mt-1">Accounting months — salary and the month-end payments count in the month they fund. Transfers between your own accounts and work claims are left out.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-full bg-surface border border-line">
            <button className="p-2 text-muted" onClick={() => setEndMonth(addMonths(endMonth, -1))} aria-label="Earlier"><Icon name="left" size={18} /></button>
            <span className="px-1 text-sm font-semibold whitespace-nowrap">to {monthLabel(endMonth)}</span>
            <button className="p-2 text-muted disabled:opacity-30" disabled={endMonth >= thisMonth()} onClick={() => setEndMonth(addMonths(endMonth, 1))} aria-label="Later"><Icon name="right" size={18} /></button>
          </div>
          <div className="inline-flex rounded-full bg-surface-2 p-1 text-sm whitespace-nowrap">
            {[3, 6, 12].map(n => <button key={n} onClick={() => setSpan(n)} className={`px-3 py-1 rounded-full font-medium ${span === n ? 'bg-surface shadow-sm' : 'text-muted'}`}>{n} months</button>)}
          </div>
          <button className="btn btn-ghost !py-1.5 !text-xs" onClick={csv}>Export CSV</button>
        </div>
      </div>

      <Card className="!p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm num min-w-[40rem]">
            <thead className="sticky top-0 bg-surface z-10">
              <tr className="text-xs text-muted border-b border-line">
                <th className="text-left font-semibold py-2.5 pl-4 pr-2 sticky left-0 bg-surface min-w-[11rem]">Line</th>
                {months.map(m => <th key={m} className={`text-right py-2.5 px-2 whitespace-nowrap ${m === thisMonth() ? 'text-ink' : ''}`}>{monthLabel(m, true)}{m === thisMonth() ? '*' : ''}</th>)}
                <th className="text-right py-2.5 pl-2 pr-4 whitespace-nowrap">Avg</th>
              </tr>
            </thead>
            <tbody>
              <Section label="Income" />
              {income.map(b => <BlockRows key={b.id} b={b} months={months} open={open.has(b.id)} toggle={() => toggle(b.id)} />)}
              <TotalRow label="Total income" vals={totals.income} tone="good" />
              <Section label="Expenses" />
              {expense.map(b => <BlockRows key={b.id} b={b} months={months} open={open.has(b.id)} toggle={() => toggle(b.id)} />)}
              <TotalRow label="Total expenses" vals={totals.expense} />
              <TotalRow label="of which discretionary" vals={totals.disc} muted />
              <TotalRow label="Net for the month" vals={totals.net} net />
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted px-4 py-3">* {monthLabel(thisMonth())} is still running. Tap a category for its sub-categories; tap a sub-category to open its transactions. A red figure is above that category’s budget for the month.</p>
      </Card>
    </div>
  )
}

function Section({ label }: { label: string }) {
  return <tr><td colSpan={99} className="pt-4 pb-1 pl-4 text-[11px] font-semibold uppercase tracking-wide text-muted font-sans">{label}</td></tr>
}

function BlockRows({ b, months, open, toggle }: { b: Block; months: string[]; open: boolean; toggle: () => void }) {
  const last = months.length - 1
  return (
    <>
      <tr className="border-t border-line cursor-pointer hover:bg-surface-2" onClick={toggle}>
        <td className="py-2 pl-4 pr-2 font-sans font-medium sticky left-0 bg-surface">
          <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: b.color ?? 'var(--muted)' }} />{b.name}<Icon name="right" size={13} className={`text-muted transition ${open ? 'rotate-90' : ''}`} /></span>
        </td>
        {b.vals.map((v, k) => <td key={k} className={`text-right px-2 whitespace-nowrap ${b.budget !== undefined && k === last && v > b.budget ? 'text-bad font-semibold' : ''}`}>{v ? rand0(v) : <span className="text-muted">–</span>}</td>)}
        <td className="text-right pl-2 pr-4 text-muted whitespace-nowrap">{rand0(sum(b.vals) / months.length)}</td>
      </tr>
      {open && b.subs.map(s => (
        <tr key={s.id} className="text-muted hover:bg-surface-2">
          <td className="py-1.5 pl-10 pr-2 font-sans sticky left-0 bg-surface">
            <Link to={`/categories/sub/${s.id}?m=${months[last]}`} className="hover:text-pine">{s.name}{s.disc && <span className="ml-1.5 text-[10px] uppercase tracking-wide">disc</span>}</Link>
          </td>
          {s.vals.map((v, k) => <td key={k} className="text-right px-2 whitespace-nowrap">{v ? rand0(v) : '–'}</td>)}
          <td className="text-right pl-2 pr-4 whitespace-nowrap">{rand0(sum(s.vals) / months.length)}</td>
        </tr>
      ))}
    </>
  )
}

function TotalRow({ label, vals, tone, muted, net }: { label: string; vals: number[]; tone?: 'good'; muted?: boolean; net?: boolean }) {
  const a = sum(vals) / Math.max(1, vals.length)
  const cls = (v: number) => net ? (v < 0 ? 'text-bad' : 'text-good') : tone === 'good' ? 'text-good' : ''
  return (
    <tr className={`border-t ${net ? 'border-ink/40 bg-surface-2' : 'border-line'} ${muted ? 'text-muted' : 'font-semibold'}`}>
      <td className={`py-2.5 pl-4 pr-2 font-sans sticky left-0 ${net ? 'bg-surface-2' : 'bg-surface'}`}>{label}</td>
      {vals.map((v, k) => <td key={k} className={`text-right px-2 whitespace-nowrap ${cls(v)}`}>{net ? (v < 0 ? '−' : '+') : ''}{rand0(v)}</td>)}
      <td className={`text-right pl-2 pr-4 whitespace-nowrap ${cls(a)}`}>{net ? (a < 0 ? '−' : '+') : ''}{rand0(a)}</td>
    </tr>
  )
}
