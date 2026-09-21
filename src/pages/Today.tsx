import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useFinance } from '../context/FinanceContext'
import { useAuth } from '../context/AuthContext'
import { getTxns, useLoad } from '../lib/data'
import { addMonths, daysInMonth, monthLabel, rand0, randK, thisMonth, today } from '../lib/format'
import { AXIS, Bar, Card, GRID, Legend, Ring, Tip } from '../components/Charts'
import { TxnList } from '../components/Txns'

export default function Today() {
  const { member } = useAuth()
  const { monthly, categories, budget, reload: reloadFinance } = useFinance()
  const month = thisMonth(), prev = addMonths(month, -1)
  const dim = daysInMonth(month), dayNo = +today().slice(8, 10), daysLeft = dim - dayNo + 1

  // discretionary lines for this month and last (pace chart), plus the latest activity on any account
  const { data, reload } = useLoad(async () => {
    const [disc, recent] = await Promise.all([
      getTxns({ from: `${prev}-01`, to: `${month}-${dim}`, discretionary: true }),
      getTxns({ limit: 12 }),
    ])
    return { disc, recent }
  }, [month])
  const refresh = () => { void reload(); void reloadFinance() }

  const spent = useMemo(() => -(data?.disc ?? []).filter(t => t.month === month).reduce((s, t) => s + t.amount, 0), [data, month])
  const left = budget - spent
  const perDay = left / daysLeft
  const projected = dayNo > 0 ? (spent / dayNo) * dim : 0
  const spentToday = -(data?.disc ?? []).filter(t => t.txn_date === today()).reduce((s, t) => s + t.amount, 0)

  const pace = useMemo(() => {
    const cum = (m: string) => { const a = Array(32).fill(0); for (const t of data?.disc ?? []) if (t.month === m) a[+t.txn_date.slice(8, 10)] -= t.amount; for (let i = 1; i < 32; i++) a[i] += a[i - 1]; return a }
    const a = cum(month), b = cum(prev)
    return Array.from({ length: dim }, (_, i) => ({ day: i + 1, now: i + 1 <= dayNo ? Math.round(a[i + 1]) : undefined, last: Math.round(b[Math.min(i + 1, 31)]), plan: Math.round((budget / dim) * (i + 1)) }))
  }, [data, month, prev, dim, dayNo, budget])

  // where it is going: this month's discretionary sub-categories against their usual (avg of the previous 6 months)
  const leaks = useMemo(() => {
    const usualMonths = Array.from({ length: 6 }, (_, i) => addMonths(month, -1 - i))
    const m = new Map<number, { id: number; name: string; cat: string; now: number; usual: number }>()
    for (const r of monthly) {
      if (r.kind !== 'expense' || !r.discretionary) continue
      const e = m.get(r.sub_id) ?? { id: r.sub_id, name: r.sub_name, cat: r.cat_name, now: 0, usual: 0 }
      if (r.month === month) e.now -= r.total; else if (usualMonths.includes(r.month)) e.usual -= r.total / 6
      m.set(r.sub_id, e)
    }
    return [...m.values()].filter(e => e.now > 0).sort((a, b) => b.now - a.now).slice(0, 7)
  }, [monthly, month])
  const leakMax = Math.max(1, ...leaks.map(l => Math.max(l.now, l.usual)))

  const hour = new Date().getHours()
  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted">{new Date().toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <h1 className="display text-3xl md:text-4xl">Good {hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'}, {member?.display_name}</h1>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-2 flex flex-col items-center text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted mb-3">Discretionary · {monthLabel(month)}</p>
          <Ring value={spent} max={budget}>
            <div>
              <p className={`display text-4xl num ${left < 0 ? 'text-bad' : ''}`}>{rand0(left)}</p>
              <p className="text-sm text-muted">{left < 0 ? 'over budget' : 'left to spend'}</p>
            </div>
          </Ring>
          <p className="mt-3 text-sm text-muted"><span className="num font-semibold text-ink">{rand0(spent)}</span> of <Link to="/settings" className="underline decoration-dotted">{rand0(budget)}</Link> spent</p>
          <div className="grid grid-cols-3 gap-2 w-full mt-5 text-left">
            <Stat label={left >= 0 ? 'Per day left' : 'Days left'} value={left >= 0 ? rand0(perDay) : String(daysLeft)} hint={`${daysLeft} day${daysLeft === 1 ? '' : 's'} to go`} />
            <Stat label="Today" value={rand0(spentToday)} hint={left >= 0 && spentToday > perDay ? 'above daily pace' : 'so far'} warn={left >= 0 && spentToday > perDay} />
            <Stat label="On track for" value={rand0(projected)} hint={projected > budget ? `${rand0(projected - budget)} over` : 'inside budget'} warn={projected > budget} />
          </div>
        </Card>

        <Card className="lg:col-span-3" title="Spending pace" sub="Cumulative discretionary spend, day by day">
          <Legend items={[{ label: monthLabel(month), color: 'var(--s1)' }, { label: monthLabel(prev), color: 'var(--s2)', dashed: true }, { label: 'Budget pace', color: 'var(--muted)', dashed: true }]} />
          <div className="h-64">
            <ResponsiveContainer>
              <ComposedChart data={pace} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="day" {...AXIS} interval={4} />
                <YAxis {...AXIS} tickFormatter={randK} width={48} />
                <Tooltip content={<Tip labelFormat={d => `Day ${d}`} />} cursor={{ stroke: 'var(--muted)', strokeWidth: 1 }} />
                <Line name="Budget pace" dataKey="plan" stroke="var(--muted)" strokeWidth={1.5} strokeDasharray="3 4" dot={false} activeDot={false} />
                <Line name={monthLabel(prev)} dataKey="last" stroke="var(--s2)" strokeWidth={2} strokeDasharray="5 4" dot={false} />
                <Area name={monthLabel(month)} dataKey="now" stroke="var(--s1)" strokeWidth={2.5} fill="var(--s1)" fillOpacity={0.12} dot={false} />
                <ReferenceLine x={dayNo} stroke="var(--line)" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-2" title="Where it’s going" sub="This month vs your usual month (tick = 6-month average)">
          {leaks.length === 0 && <p className="text-sm text-muted">No discretionary spend yet this month.</p>}
          <div className="space-y-3.5">
            {leaks.map(l => (
              <Link key={l.id} to={`/categories/sub/${l.id}?m=${month}`} className="block group">
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium group-hover:text-pine">{l.name}</span>
                  <span className="num"><span className="font-semibold">{rand0(l.now)}</span>{l.usual > 0 && <span className={`ml-2 text-xs ${l.now > l.usual ? 'text-bad' : 'text-muted'}`}>{l.now > l.usual ? '▲' : '▽'} usual {rand0(l.usual)}</span>}</span>
                </div>
                <Bar value={l.now} max={leakMax} mark={l.usual || undefined} />
              </Link>
            ))}
          </div>
        </Card>

        <Card className="lg:col-span-3" title="Latest activity" right={<Link to="/transactions" className="text-sm font-semibold text-pine">All transactions</Link>}>
          <TxnList txns={data?.recent ?? []} categories={categories} onChanged={refresh} dayTotals={false} />
        </Card>
      </div>
    </div>
  )
}

function Stat({ label, value, hint, warn }: { label: string; value: string; hint: string; warn?: boolean }) {
  return (
    <div className="rounded-2xl bg-surface-2 px-3 py-2.5">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="num font-semibold text-lg leading-tight">{value}</p>
      <p className={`text-[11px] ${warn ? 'text-bad font-semibold' : 'text-muted'}`}>{warn ? '▲ ' : ''}{hint}</p>
    </div>
  )
}
