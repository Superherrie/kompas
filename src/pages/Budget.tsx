import { useMemo, useState } from 'react'
import { useFinance } from '../context/FinanceContext'
import { addMonths, daysInMonth, monthLabel, rand0, thisMonth, today } from '../lib/format'
import { Card } from '../components/Charts'
import Icon from '../components/Icon'
import { CellSheet, Section, type Cell } from './IncomeStatement'

type Sub = { id: number; name: string; disc?: boolean; actual: number }
type Line = { id: number; name: string; color: string | null; budget: number | null; actual: number; subs: Sub[] }

/** One accounting month as budget against actual, laid out like the income statement.
 *  Expenses are budgeted per category (pf_budgets, carried forward by budgetFor); their sub-categories show actual only.
 *  Income is one category, so it is listed by SOURCE (its sub-categories: Salary, Rental Income, …), each with its own budget.
 *  Expenses: variance = budget − actual (positive = money left). Income: variance = actual − budget.
 *  Transfers and work claims are left out, as on the Income Statement. */
export default function Budget() {
  const { monthly, categories, budgetFor, budget: discBudget } = useFinance()
  const [month, setMonth] = useState(thisMonth())
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [cell, setCell] = useState<Cell>()
  const running = month === thisMonth()

  const { income, expense, incomeBudgeted, totals } = useMemo(() => {
    const build = (kind: 'income' | 'expense') => {
      const m = new Map<number, Line>()
      // income lines are the sources (sub-categories); expense lines are the categories
      const keyOf = (r: typeof monthly[number]) => kind === 'income' ? r.sub_id : r.cat_id
      for (const r of monthly) {
        if (r.kind !== kind || r.month !== month) continue
        const line = m.get(keyOf(r)) ?? { id: keyOf(r), name: kind === 'income' ? r.sub_name : r.cat_name, color: r.color, budget: null, actual: 0, subs: [] }
        const v = kind === 'expense' ? -r.total : r.total
        line.actual += v
        if (kind === 'expense') { const s = line.subs.find(x => x.id === r.sub_id); if (s) s.actual += v; else line.subs.push({ id: r.sub_id, name: r.sub_name, disc: r.discretionary, actual: v }) }
        m.set(keyOf(r), line)
      }
      // a line with a budget but nothing booked yet still belongs on the page
      const incomeParent = categories.find(c => c.parent_id === null && c.kind === 'income')
      for (const c of categories) {
        if (kind === 'expense' ? c.parent_id !== null || c.kind !== 'expense' : c.parent_id !== incomeParent?.id) continue
        const b = budgetFor(c.id, month)
        if (b === undefined) continue
        const line = m.get(c.id) ?? { id: c.id, name: c.name, color: c.color, budget: null, actual: 0, subs: [] }
        line.budget = b; m.set(c.id, line)
      }
      const lines = [...m.values()].filter(l => Math.abs(l.actual) >= 0.5 || (l.budget ?? 0) > 0)
      for (const l of lines) l.subs.sort((a, b) => b.actual - a.actual)
      // biggest overspend first, then the biggest lines
      return lines.sort((a, b) => (b.actual - (b.budget ?? 0)) - (a.actual - (a.budget ?? 0)) || b.actual - a.actual)
    }
    const income = build('income'), expense = build('expense')
    const incomeBudgeted = income.some(l => l.budget !== null)
    const sum = (ls: Line[], f: (l: Line) => number) => ls.reduce((s, l) => s + f(l), 0)
    const totals = {
      incomeBudget: incomeBudgeted ? sum(income, l => l.budget ?? 0) : null, incomeActual: sum(income, l => l.actual),
      expenseBudget: sum(expense, l => l.budget ?? 0), expenseActual: sum(expense, l => l.actual),
      discActual: sum(expense, l => l.subs.filter(s => s.disc).reduce((t, s) => t + s.actual, 0)),
    }
    return { income, expense, incomeBudgeted, totals }
  }, [monthly, categories, budgetFor, month])

  const toggle = (id: number) => setOpen(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const dayOf = +today().slice(8, 10), days = daysInMonth(month)
  const netBudget = totals.incomeBudget === null ? null : totals.incomeBudget - totals.expenseBudget
  const netActual = totals.incomeActual - totals.expenseActual

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-3xl md:text-4xl">Budget</h1>
          <p className="text-sm text-muted mt-1">Budget against actual for one accounting month. Transfers between your own accounts and work claims are left out.</p>
        </div>
        <div className="inline-flex items-center rounded-full bg-surface border border-line">
          <button className="p-2 text-muted" onClick={() => setMonth(addMonths(month, -1))} aria-label="Earlier"><Icon name="left" size={18} /></button>
          <span className="px-1 text-sm font-semibold whitespace-nowrap">{monthLabel(month)}</span>
          <button className="p-2 text-muted disabled:opacity-30" disabled={month >= thisMonth()} onClick={() => setMonth(addMonths(month, 1))} aria-label="Later"><Icon name="right" size={18} /></button>
        </div>
      </div>

      {running && (
        <p className="text-xs font-semibold uppercase tracking-wide text-gold">
          Month in progress — day {dayOf} of {days}; the actuals below are {Math.round(dayOf / days * 100)}% of the way through the month.
        </p>
      )}

      {/* the headline: three tiles that fit a phone in one row */}
      <div className="grid grid-cols-3 gap-2">
        <Tile label="Budgeted spend" value={rand0(totals.expenseBudget)} />
        <Tile label="Spent so far" value={rand0(totals.expenseActual)} tone={totals.expenseActual > totals.expenseBudget ? 'bad' : undefined} />
        <Tile label={totals.expenseBudget >= totals.expenseActual ? 'Left' : 'Over'} value={rand0(Math.abs(totals.expenseBudget - totals.expenseActual))} tone={totals.expenseBudget >= totals.expenseActual ? 'good' : 'bad'} />
      </div>

      <Card className="!p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm num min-w-[22rem]">
            <thead className="sticky top-0 bg-surface z-10">
              <tr className="text-[11px] text-muted border-b border-line">
                <th className="text-left font-semibold py-2.5 pl-3 pr-1 sticky left-0 bg-surface min-w-[7.5rem]">Line</th>
                <th className="text-right py-2.5 px-1 whitespace-nowrap">Budget</th>
                <th className="text-right py-2.5 px-1 whitespace-nowrap">Actual</th>
                <th className="text-right py-2.5 pl-1 pr-3 whitespace-nowrap">Variance</th>
              </tr>
            </thead>
            <tbody>
              <Section label="Income" />
              {income.length === 0 && <tr><td colSpan={4} className="px-3 py-2 text-xs text-muted font-sans">Nothing received yet this month.</td></tr>}
              {income.map(l => <Rows key={l.id} l={l} kind="income" month={month} open={false} toggle={() => undefined} onCell={setCell} />)}
              <TotalRow label="Total income" budget={totals.incomeBudget} actual={totals.incomeActual} kind="income" />
              {!incomeBudgeted && <tr><td colSpan={4} className="px-3 pb-2 text-[11px] text-muted font-sans">No income budget has been set, so income shows actuals only.</td></tr>}
              <Section label="Expenses" />
              {expense.map(l => <Rows key={l.id} l={l} kind="expense" month={month} open={open.has(l.id)} toggle={() => toggle(l.id)} onCell={setCell} />)}
              <TotalRow label="Total expenses" budget={totals.expenseBudget} actual={totals.expenseActual} kind="expense" />
              <TotalRow label="of which discretionary" budget={discBudget || null} actual={totals.discActual} kind="expense" muted />
              <TotalRow label="Net for the month" budget={netBudget} actual={netActual} kind="income" net />
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted px-3 py-3">
          Variance is budget less actual for expenses (red = over budget) and actual less budget for income. Budgets are set per category; a category with spend but no budget line counts against R 0.
          Tap a category name for its sub-categories; tap any figure to see the transactions behind it.
        </p>
      </Card>
      {cell && <CellSheet cell={cell} onClose={() => setCell(undefined)} />}
    </div>
  )
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="card !p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p className={`num font-semibold text-base md:text-xl mt-0.5 ${tone === 'bad' ? 'text-bad' : tone === 'good' ? 'text-good' : ''}`}>{value}</p>
    </div>
  )
}

/** variance text with its colour; sign shown for net-style rows */
function Variance({ budget, actual, kind, signed = false }: { budget: number | null; actual: number; kind: 'income' | 'expense'; signed?: boolean }) {
  if (budget === null) return <span className="text-muted">—</span>
  const v = kind === 'expense' ? budget - actual : actual - budget
  const cls = Math.abs(v) < 0.5 ? 'text-muted' : v < 0 ? 'text-bad font-semibold' : 'text-good'
  return <span className={cls}>{v < -0.5 ? '−' : signed && v > 0.5 ? '+' : ''}{rand0(v)}</span>
}

/** a figure that opens its transactions when tapped; a zero stays plain */
function Figure({ v, onClick, className = '' }: { v: number; onClick: () => void; className?: string }) {
  if (Math.abs(v) < 0.5) return <td className="text-right px-1 whitespace-nowrap text-muted">–</td>
  return (
    <td className={`text-right whitespace-nowrap ${className}`}>
      <button onClick={onClick} title="See the transactions" className="w-full text-right px-1 py-0.5 rounded-md hover:bg-pine/10 hover:text-pine focus:outline-none focus:ring-1 focus:ring-pine/40">{rand0(v)}</button>
    </td>
  )
}

function Rows({ l, kind, month, open, toggle, onCell }: { l: Line; kind: 'income' | 'expense'; month: string; open: boolean; toggle: () => void; onCell: (c: Cell) => void }) {
  const over = kind === 'expense' && l.budget !== null && l.actual > l.budget + 0.5
  const expandable = kind === 'expense'
  // an income line is a sub-category (source); an expense line is a category
  const cell: Cell = kind === 'income' ? { name: l.name, month, subId: l.id } : { name: l.name, month, catId: l.id }
  return (
    <>
      <tr className="border-t border-line hover:bg-surface-2">
        <td className={`py-2 pl-3 pr-1 font-sans font-medium sticky left-0 bg-surface ${expandable ? 'cursor-pointer' : ''}`} onClick={expandable ? toggle : undefined}>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: l.color ?? 'var(--muted)' }} /><span className="truncate max-w-[6.5rem] md:max-w-none">{l.name}</span>{expandable && <Icon name="right" size={13} className={`text-muted shrink-0 transition ${open ? 'rotate-90' : ''}`} />}</span>
        </td>
        <td className="text-right px-1 whitespace-nowrap text-muted">{l.budget === null ? '—' : rand0(l.budget)}</td>
        <Figure v={l.actual} onClick={() => onCell(cell)} className={over ? 'text-bad font-semibold' : ''} />
        <td className="text-right pl-1 pr-3 whitespace-nowrap"><Variance budget={l.budget} actual={l.actual} kind={kind} /></td>
      </tr>
      {open && l.subs.map(s => (
        <tr key={s.id} className="text-muted hover:bg-surface-2">
          <td className="py-1.5 pl-7 pr-1 font-sans sticky left-0 bg-surface"><span className="truncate block max-w-[6.5rem] md:max-w-none">{s.name}{s.disc && <span className="ml-1 text-[10px] uppercase tracking-wide">disc</span>}</span></td>
          <td className="text-right px-1 text-muted/60">·</td>
          <Figure v={s.actual} onClick={() => onCell({ name: `${l.name} › ${s.name}`, month, subId: s.id })} />
          <td className="text-right pl-1 pr-3 text-muted/60">·</td>
        </tr>
      ))}
    </>
  )
}

function TotalRow({ label, budget, actual, kind, muted, net }: { label: string; budget: number | null; actual: number; kind: 'income' | 'expense'; muted?: boolean; net?: boolean }) {
  const show = (v: number | null) => v === null ? '—' : `${net ? (v < 0 ? '−' : '+') : ''}${rand0(v)}`
  const cls = (v: number | null) => net && v !== null ? (v < 0 ? 'text-bad' : 'text-good') : ''
  return (
    <tr className={`border-t ${net ? 'border-ink/40 bg-surface-2' : 'border-line'} ${muted ? 'text-muted' : 'font-semibold'}`}>
      <td className={`py-2.5 pl-3 pr-1 font-sans sticky left-0 ${net ? 'bg-surface-2' : 'bg-surface'}`}>{label}</td>
      <td className={`text-right px-1 whitespace-nowrap ${cls(budget)}`}>{show(budget)}</td>
      <td className={`text-right px-1 whitespace-nowrap ${cls(actual)}`}>{show(actual)}</td>
      <td className="text-right pl-1 pr-3 whitespace-nowrap"><Variance budget={budget} actual={actual} kind={kind} signed /></td>
    </tr>
  )
}
