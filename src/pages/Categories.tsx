import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Bar as RBar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useFinance } from '../context/FinanceContext'
import { getTxns, useLoad } from '../lib/data'
import { addMonths, monthLabel, rand, rand0, randK, thisMonth } from '../lib/format'
import { AXIS, Bar, Card, GRID, Tip } from '../components/Charts'
import { TxnList } from '../components/Txns'
import Icon from '../components/Icon'
import { byVendor, vendorOf } from '../lib/vendor'

// eslint-disable-next-line react-refresh/only-export-components
export function useMonthParam() {
  const [sp, setSp] = useSearchParams()
  const month = sp.get('m') ?? thisMonth()
  return [month, (m: string) => setSp(p => { p.set('m', m); return p }, { replace: true })] as const
}

export function MonthNav({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  return (
    <div className="inline-flex items-center rounded-full bg-surface border border-line">
      <button className="p-2 text-muted" onClick={() => onChange(addMonths(month, -1))} aria-label="Previous month"><Icon name="left" size={18} /></button>
      <span className="px-2 text-sm font-semibold min-w-24 text-center">{monthLabel(month)}</span>
      <button className="p-2 text-muted disabled:opacity-30" disabled={month >= thisMonth()} onClick={() => onChange(addMonths(month, 1))} aria-label="Next month"><Icon name="right" size={18} /></button>
    </div>
  )
}

type Scope = 'all' | 'disc' | 'fixed'

/** Level 1: categories for a month → expand to sub-categories → click through to the transactions. */
export default function Categories() {
  const { monthly, budgetFor } = useFinance()
  const [month, setMonth] = useMonthParam()
  const [scope, setScope] = useState<Scope>('all')
  // the expanded category lives in the URL (?c=) so Back from a detail page lands on the same open list
  const [sp, setSp] = useSearchParams()
  const open = sp.get('c') ? +sp.get('c')! : undefined
  const setOpen = (id?: number) => setSp(p => { if (id) p.set('c', String(id)); else p.delete('c'); return p }, { replace: true })

  const { cats, total, income } = useMemo(() => {
    const prevMonths = Array.from({ length: 6 }, (_, i) => addMonths(month, -1 - i))
    const m = new Map<number, { id: number; name: string; color: string | null; now: number; usual: number; subs: Map<number, { id: number; name: string; disc: boolean; now: number; usual: number; n: number }> }>()
    let income = 0
    for (const r of monthly) {
      if (r.kind === 'income' && r.month === month) income += r.total
      if (r.kind !== 'expense' || (scope === 'disc' && !r.discretionary) || (scope === 'fixed' && r.discretionary)) continue
      const isNow = r.month === month, isPrev = prevMonths.includes(r.month)
      if (!isNow && !isPrev) continue
      const c = m.get(r.cat_id) ?? { id: r.cat_id, name: r.cat_name, color: r.color, now: 0, usual: 0, subs: new Map() }
      const s = c.subs.get(r.sub_id) ?? { id: r.sub_id, name: r.sub_name, disc: r.discretionary, now: 0, usual: 0, n: 0 }
      if (isNow) { c.now -= r.total; s.now -= r.total; s.n += r.n } else { c.usual -= r.total / 6; s.usual -= r.total / 6 }
      c.subs.set(r.sub_id, s); m.set(r.cat_id, c)
    }
    const cats = [...m.values()].filter(c => c.now > 0 || c.usual > 0).sort((a, b) => b.now - a.now)
    return { cats, total: cats.reduce((s, c) => s + c.now, 0), income }
  }, [monthly, month, scope])
  const max = Math.max(1, ...cats.map(c => Math.max(c.now, budgetFor(c.id, month) ?? c.usual)))
  const budgetTotal = cats.reduce((s, c) => s + (budgetFor(c.id, month) ?? 0), 0)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="display text-3xl md:text-4xl">Categories</h1>
        <MonthNav month={month} onChange={setMonth} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-full bg-surface-2 p-1 text-sm">
          {([['all', 'Everything'], ['disc', 'Discretionary'], ['fixed', 'Fixed & essential']] as [Scope, string][]).map(([k, l]) =>
            <button key={k} onClick={() => setScope(k)} className={`px-3 py-1 rounded-full font-medium ${scope === k ? 'bg-surface shadow-sm' : 'text-muted'}`}>{l}</button>)}
        </div>
        <p className="text-sm text-muted">Spent <span className={`num font-semibold ${budgetTotal && total > budgetTotal ? 'text-bad' : 'text-ink'}`}>{rand0(total)}</span>{budgetTotal > 0 && <> of <span className="num font-semibold text-ink">{rand0(budgetTotal)}</span> budget</>}{scope === 'all' && income > 0 && <> · income <span className="num font-semibold text-ink">{rand0(income)}</span></>}</p>
      </div>

      <Card>
        {cats.length === 0 && <p className="text-sm text-muted">Nothing recorded for {monthLabel(month)}.</p>}
        <div className="divide-y divide-line">
          {cats.map(c => { const b = budgetFor(c.id, month); const over = b !== undefined && c.now > b; return (
            <div key={c.id} className="py-3">
              <button className="w-full text-left" onClick={() => setOpen(open === c.id ? undefined : c.id)}>
                <div className="flex items-center justify-between gap-3 mb-1.5">
                  <span className="flex items-center gap-2 font-medium"><span className="w-2.5 h-2.5 rounded-full" style={{ background: c.color ?? 'var(--muted)' }} />{c.name}<Icon name="right" size={14} className={`text-muted transition ${open === c.id ? 'rotate-90' : ''}`} /></span>
                  <span className="num text-sm"><span className={`font-semibold ${over ? 'text-bad' : ''}`}>{over ? '▲ ' : ''}{rand0(c.now)}</span>{b !== undefined && <span className="text-muted ml-1.5">/ {rand0(b)}</span>}</span>
                </div>
                <Bar value={c.now} max={max} mark={b ?? (c.usual || undefined)} color={c.color ?? undefined} />
              </button>
              {open === c.id && (
                <div className="mt-3 ml-4 space-y-1">
                  {[...c.subs.values()].sort((a, b) => b.now - a.now).map(s => (
                    <Link key={s.id} to={`/categories/sub/${s.id}?m=${month}`} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 hover:bg-surface-2">
                      <span className="text-sm">{s.name}{s.disc && <span className="chip ml-2 !py-0">discretionary</span>}<span className="text-xs text-muted ml-2">{s.n} txn{s.n === 1 ? '' : 's'}</span></span>
                      <span className="num text-sm flex items-center gap-2"><span className="text-xs text-muted hidden sm:inline">usual {rand0(s.usual)}</span><span className="font-semibold">{rand0(s.now)}</span><Icon name="right" size={14} className="text-muted" /></span>
                    </Link>
                  ))}
                  <Link to={`/categories/cat/${c.id}?m=${month}`} className="block px-3 py-2 text-sm font-semibold text-pine">All {c.name} transactions →</Link>
                </div>
              )}
            </div>
          ) })}
        </div>
        <p className="text-xs text-muted mt-3">The tick on each bar is the month’s budget (or, where there is none, your six-month average).</p>
      </Card>
    </div>
  )
}

/** Level 2/3: one category or sub-category — trend over time, then every transaction for the chosen month. */
export function CategoryDetail() {
  const { level, id } = useParams(); const cid = +(id ?? 0); const isSub = level === 'sub'
  const { monthly, categories, months, reload: reloadFinance } = useFinance()
  const [month, setMonth] = useMonthParam()
  const nav = useNavigate()
  // back = wherever you came from (Today, Categories, the parent category); a bookmarked page falls back to the category list
  const back = () => (window.history.state?.idx ?? 0) > 0 ? nav(-1) : nav(`/categories?m=${month}`)
  const me = categories.find(c => c.id === cid)
  const parent = isSub ? categories.find(c => c.id === me?.parent_id) : undefined

  const trend = useMemo(() => months.slice(-13).map(m => ({
    m, v: Math.round(-monthly.filter(r => r.month === m && (isSub ? r.sub_id : r.cat_id) === cid).reduce((s, r) => s + r.total, 0)),
  })), [monthly, months, cid, isSub])
  const { data: txns, reload } = useLoad(() => getTxns({ month, ...(isSub ? { subId: cid } : { catId: cid }) }), [month, cid, isSub])
  const total = (txns ?? []).reduce((s, t) => s + t.amount, 0)

  // by vendor: this month, or the 6 / 12 accounting months ending with it
  const [span, setSpan] = useState(1); const [vendor, setVendor] = useState<string>(); const [allVendors, setAllVendors] = useState(false)
  const spanMonths = useMemo(() => Array.from({ length: span }, (_, i) => addMonths(month, -i)), [month, span])
  const { data: spanTxns, reload: reloadSpan } = useLoad(
    () => span === 1 ? Promise.resolve(undefined) : getTxns({ months: spanMonths, ...(isSub ? { subId: cid } : { catId: cid }) }), [spanMonths.join(), cid, isSub])
  const pool = useMemo(() => (span === 1 ? txns : spanTxns) ?? [], [span, txns, spanTxns])
  const vendors = useMemo(() => byVendor(pool.filter(t => t.kind === 'expense')), [pool])
  const vendorTotal = vendors.reduce((t, v) => t + v.total, 0), vendorMax = Math.max(1, ...vendors.map(v => v.total))
  const shown = vendor ? pool.filter(t => vendorOf(t.description) === vendor) : txns ?? []
  const refresh = () => { void reload(); void reloadSpan(); void reloadFinance() }

  return (
    <div className="space-y-5">
      <div>
        <button onClick={back} className="btn btn-ghost !py-1.5 !pl-2.5 !pr-4 mb-3"><Icon name="left" size={18} />Back</button>
        <p className="text-sm text-muted"><Link to={`/categories?m=${month}`} className="hover:text-pine">Categories</Link>{parent && <> / <Link to={`/categories/cat/${parent.id}?m=${month}`} className="hover:text-pine">{parent.name}</Link></>}</p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="display text-3xl md:text-4xl">{me?.name ?? '…'}</h1>
          <MonthNav month={month} onChange={setMonth} />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Last 13 months" sub="Click a bar to see that month’s transactions">
          <div className="h-56"><ResponsiveContainer>
            <BarChart data={trend} margin={{ top: 8, right: 4, left: -8, bottom: 0 }} onClick={e => e?.activeLabel && setMonth(String(e.activeLabel))} style={{ cursor: 'pointer' }}>
              <CartesianGrid {...GRID} /><XAxis dataKey="m" {...AXIS} tickFormatter={m => monthLabel(m, true)} minTickGap={12} /><YAxis {...AXIS} tickFormatter={randK} width={48} />
              <Tooltip content={<Tip labelFormat={monthLabel} />} cursor={{ fill: 'var(--surface-2)' }} />
              <RBar name={me?.name ?? 'Spend'} dataKey="v" radius={[4, 4, 0, 0]} maxBarSize={22}>
                {trend.map(t => <Cell key={t.m} fill="var(--s1)" fillOpacity={t.m === month ? 1 : 0.4} />)}
              </RBar>
            </BarChart>
          </ResponsiveContainer></div>
        </Card>
        <Card title={monthLabel(month)}>
          <p className="display text-4xl num">{rand(total)}</p>
          <p className="text-sm text-muted mb-4">{txns?.length ?? 0} transaction{txns?.length === 1 ? '' : 's'}</p>
          {vendors.slice(0, 5).map(v => <div key={v.vendor} className="flex justify-between text-sm py-1 border-t border-line"><span className="truncate pr-3">{v.vendor} <span className="text-muted">×{v.n}</span></span><span className="num font-medium">{rand0(v.total)}</span></div>)}
        </Card>
      </div>

      <Card title="By vendor" sub="Where the money in this category goes — tap a vendor to see its transactions"
        right={<div className="inline-flex rounded-full bg-surface-2 p-1 text-xs">{([[1, 'Month'], [6, '6 months'], [12, '12 months']] as [number, string][]).map(([n, l]) =>
          <button key={n} onClick={() => { setSpan(n); setVendor(undefined) }} className={`px-2.5 py-1 rounded-full font-medium ${span === n ? 'bg-surface shadow-sm' : 'text-muted'}`}>{l}</button>)}</div>}>
        {vendors.length === 0 && <p className="text-sm text-muted">Nothing spent here {span === 1 ? `in ${monthLabel(month)}` : `in these ${span} months`}.</p>}
        <div className="divide-y divide-line">
          {(allVendors ? vendors : vendors.slice(0, 12)).map(v => (
            <button key={v.vendor} onClick={() => setVendor(vendor === v.vendor ? undefined : v.vendor)} className={`w-full text-left py-2.5 ${vendor === v.vendor ? 'bg-pine/10 -mx-2 px-2 rounded-xl' : ''}`}>
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <span className="text-sm font-medium truncate">{v.vendor}</span>
                <span className="num text-sm whitespace-nowrap"><span className="text-xs text-muted mr-2">{v.n}× · {rand0(v.total / v.n)} avg{span > 1 ? ` · ${rand0(v.total / span)}/mo` : ''}</span><span className="font-semibold">{rand0(v.total)}</span><span className="text-xs text-muted ml-1.5 inline-block w-8 text-right">{Math.round((v.total / Math.max(1, vendorTotal)) * 100)}%</span></span>
              </div>
              <Bar value={v.total} max={vendorMax} color={me?.color ?? parent?.color ?? undefined} />
            </button>
          ))}
        </div>
        {vendors.length > 12 && <button className="text-sm font-semibold text-pine mt-3" onClick={() => setAllVendors(a => !a)}>{allVendors ? 'Show top 12' : `Show all ${vendors.length} vendors`}</button>}
      </Card>

      <Card title={vendor ? `${vendor} — ${shown.length} transaction${shown.length === 1 ? '' : 's'}` : 'Transactions'} sub={vendor ? (span === 1 ? monthLabel(month) : `${monthLabel(spanMonths[span - 1])} – ${monthLabel(month)}`) : undefined}
        right={vendor ? <button className="btn btn-ghost !py-1.5 !text-xs" onClick={() => setVendor(undefined)}>Show all</button> : undefined}>
        <TxnList txns={shown} categories={categories} onChanged={refresh} />
      </Card>
    </div>
  )
}
