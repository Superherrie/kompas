import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bar as RBar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useFinance } from '../context/FinanceContext'
import { monthLabel, rand0, randK } from '../lib/format'
import { AXIS, Card, GRID, Legend, OTHER, SERIES, Tip } from '../components/Charts'

const RANGES = [{ n: 6, label: '6 months' }, { n: 12, label: '12 months' }, { n: 0, label: 'All' }]

export default function Overview() {
  const { monthly, months: allMonths } = useFinance()
  const nav = useNavigate()
  const [range, setRange] = useState(12)
  const [table, setTable] = useState(false)
  const months = useMemo(() => range ? allMonths.slice(-range) : allMonths, [allMonths, range])
  const rows = useMemo(() => monthly.filter(r => months.includes(r.month) && r.kind !== 'transfer'), [monthly, months])

  // colour follows the category: slots are handed out once, by all-time spend, so changing the range never repaints
  const slot = useMemo(() => {
    const tot = new Map<string, number>()
    for (const r of monthly) if (r.kind === 'expense') tot.set(r.cat_name, (tot.get(r.cat_name) ?? 0) - r.total)
    return new Map([...tot].sort((a, b) => b[1] - a[1]).slice(0, 7).map(([c], i) => [c, SERIES[i]]))
  }, [monthly])

  const byMonth = useMemo(() => months.map(m => {
    const r = rows.filter(x => x.month === m)
    const income = r.filter(x => x.kind === 'income').reduce((s, x) => s + x.total, 0)
    const exp = -r.filter(x => x.kind === 'expense').reduce((s, x) => s + x.total, 0)
    const disc = -r.filter(x => x.kind === 'expense' && x.discretionary).reduce((s, x) => s + x.total, 0)
    const cats: Record<string, number> = {}
    for (const x of r) if (x.kind === 'expense') { const k = slot.has(x.cat_name) ? x.cat_name : 'Other'; cats[k] = (cats[k] ?? 0) - x.total }
    const acc: Record<string, number> = {}
    for (const x of r) if (x.kind === 'expense') acc[x.account] = (acc[x.account] ?? 0) - x.total
    return { m, income: Math.round(income), exp: Math.round(exp), net: Math.round(income - exp), disc: Math.round(disc), fixed: Math.round(exp - disc), ...Object.fromEntries(Object.entries(cats).map(([k, v]) => [`c:${k}`, Math.round(v)])), ...Object.fromEntries(Object.entries(acc).map(([k, v]) => [`a:${k}`, Math.round(v)])) }
  }), [rows, months, slot])

  const n = Math.max(1, months.length)
  const tot = byMonth.reduce((s, x) => ({ income: s.income + x.income, exp: s.exp + x.exp, disc: s.disc + x.disc }), { income: 0, exp: 0, disc: 0 })
  const fmt = (m: string) => monthLabel(m, true)
  const catKeys = [...slot.keys(), 'Other']
  const toMonth = (e: { activeLabel?: string | number }) => e?.activeLabel && nav(`/categories?m=${e.activeLabel}`)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="display text-3xl md:text-4xl">Overview</h1>
        <div className="flex items-center gap-2 max-w-full">
          <div className="inline-flex rounded-full bg-surface-2 p-1 text-sm whitespace-nowrap">
            {RANGES.map(r => <button key={r.n} onClick={() => setRange(r.n)} className={`px-3 py-1 rounded-full font-medium ${range === r.n ? 'bg-surface shadow-sm' : 'text-muted'}`}>{r.label}</button>)}
          </div>
          <button onClick={() => setTable(t => !t)} className="btn btn-ghost !py-1.5 !text-xs">{table ? 'Charts' : 'Table'}</button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Income / month" value={rand0(tot.income / n)} />
        <Tile label="Expenses / month" value={rand0(tot.exp / n)} />
        <Tile label="Discretionary / month" value={rand0(tot.disc / n)} hint={`${Math.round((tot.disc / Math.max(1, tot.exp)) * 100)}% of spend`} />
        <Tile label="Net / month" value={`${tot.income - tot.exp < 0 ? '−' : '+'}${rand0((tot.income - tot.exp) / n)}`} bad={tot.income - tot.exp < 0} />
      </div>

      {table ? (
        <Card title="Month by month">
          <div className="overflow-x-auto">
            <table className="w-full text-sm num">
              <thead><tr className="text-left text-xs text-muted border-b border-line"><th className="py-2">Month</th><th className="text-right">Income</th><th className="text-right">Expenses</th><th className="text-right">Discretionary</th><th className="text-right">Fixed</th><th className="text-right">Net</th></tr></thead>
              <tbody>{[...byMonth].reverse().map(x => (
                <tr key={x.m} className="border-b border-line cursor-pointer hover:bg-surface-2" onClick={() => nav(`/categories?m=${x.m}`)}>
                  <td className="py-2 font-sans font-medium">{monthLabel(x.m)}</td><td className="text-right">{rand0(x.income)}</td><td className="text-right">{rand0(x.exp)}</td>
                  <td className="text-right">{rand0(x.disc)}</td><td className="text-right">{rand0(x.fixed)}</td><td className={`text-right font-semibold ${x.net < 0 ? 'text-bad' : 'text-good'}`}>{x.net < 0 ? '−' : '+'}{rand0(x.net)}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </Card>
      ) : (
        <>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Income and expenses" sub="Click a month to open its categories">
              <Legend items={[{ label: 'Income', color: 'var(--s2)' }, { label: 'Expenses', color: 'var(--s1)' }]} />
              <div className="h-64"><ResponsiveContainer>
                <BarChart data={byMonth} barGap={2} margin={{ top: 8, right: 4, left: -8, bottom: 0 }} onClick={toMonth} style={{ cursor: 'pointer' }}>
                  <CartesianGrid {...GRID} /><XAxis dataKey="m" {...AXIS} tickFormatter={fmt} minTickGap={16} /><YAxis {...AXIS} tickFormatter={randK} width={48} />
                  <Tooltip content={<Tip labelFormat={monthLabel} />} cursor={{ fill: 'var(--surface-2)' }} />
                  <RBar name="Income" dataKey="income" fill="var(--s2)" radius={[4, 4, 0, 0]} maxBarSize={14} />
                  <RBar name="Expenses" dataKey="exp" fill="var(--s1)" radius={[4, 4, 0, 0]} maxBarSize={14} />
                </BarChart>
              </ResponsiveContainer></div>
            </Card>
            <Card title="Net position" sub="Income less expenses — below the line means the month ran at a loss">
              <div className="h-[17.5rem]"><ResponsiveContainer>
                <BarChart data={byMonth} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
                  <CartesianGrid {...GRID} /><XAxis dataKey="m" {...AXIS} tickFormatter={fmt} minTickGap={16} /><YAxis {...AXIS} tickFormatter={randK} width={48} />
                  <Tooltip content={<NetTip />} cursor={{ fill: 'var(--surface-2)' }} /><ReferenceLine y={0} stroke="var(--muted)" />
                  <RBar name="Net" dataKey="net" radius={[4, 4, 0, 0]} maxBarSize={18} fill="var(--s2)" shape={<NetBar />} />
                </BarChart>
              </ResponsiveContainer></div>
            </Card>
          </div>

          <Card title="Where the money goes" sub="Expenses by category — the seven largest, everything else as Other">
            <Legend items={catKeys.map(c => ({ label: c, color: slot.get(c) ?? OTHER }))} />
            <div className="h-72"><ResponsiveContainer>
              <BarChart data={byMonth} margin={{ top: 8, right: 4, left: -8, bottom: 0 }} onClick={toMonth} style={{ cursor: 'pointer' }}>
                <CartesianGrid {...GRID} /><XAxis dataKey="m" {...AXIS} tickFormatter={fmt} minTickGap={16} /><YAxis {...AXIS} tickFormatter={randK} width={48} />
                <Tooltip content={<Tip labelFormat={monthLabel} total />} cursor={{ fill: 'var(--surface-2)' }} />
                {catKeys.map(c => <RBar key={c} name={c} dataKey={`c:${c}`} stackId="c" fill={slot.get(c) ?? OTHER} stroke="var(--surface)" strokeWidth={2} maxBarSize={26} />)}
              </BarChart>
            </ResponsiveContainer></div>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Fixed vs discretionary" sub="Discretionary is what you can steer month to month">
              <Legend items={[{ label: 'Discretionary', color: 'var(--s1)' }, { label: 'Fixed & essential', color: 'var(--s2)' }]} />
              <div className="h-56"><ResponsiveContainer>
                <LineChart data={byMonth} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid {...GRID} /><XAxis dataKey="m" {...AXIS} tickFormatter={fmt} minTickGap={16} /><YAxis {...AXIS} tickFormatter={randK} width={48} />
                  <Tooltip content={<Tip labelFormat={monthLabel} />} cursor={{ stroke: 'var(--muted)', strokeWidth: 1 }} />
                  <Line name="Fixed & essential" dataKey="fixed" stroke="var(--s2)" strokeWidth={2} dot={false} />
                  <Line name="Discretionary" dataKey="disc" stroke="var(--s1)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer></div>
            </Card>
            <Card title="Spend by account" sub="FNB carries the monthly commitments, Discovery the daily spend">
              <Legend items={[{ label: 'FNB', color: 'var(--s2)' }, { label: 'Discovery', color: 'var(--s1)' }]} />
              <div className="h-56"><ResponsiveContainer>
                <BarChart data={byMonth} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
                  <CartesianGrid {...GRID} /><XAxis dataKey="m" {...AXIS} tickFormatter={fmt} minTickGap={16} /><YAxis {...AXIS} tickFormatter={randK} width={48} />
                  <Tooltip content={<Tip labelFormat={monthLabel} total />} cursor={{ fill: 'var(--surface-2)' }} />
                  <RBar name="FNB" dataKey="a:FNB" stackId="a" fill="var(--s2)" stroke="var(--surface)" strokeWidth={2} maxBarSize={26} />
                  <RBar name="Discovery" dataKey="a:Discovery" stackId="a" fill="var(--s1)" stroke="var(--surface)" strokeWidth={2} maxBarSize={26} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer></div>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

function Tile({ label, value, hint, bad }: { label: string; value: string; hint?: string; bad?: boolean }) {
  return <div className="card px-4 py-3"><p className="text-xs text-muted">{label}</p><p className={`display text-2xl num ${bad ? 'text-bad' : ''}`}>{value}</p>{hint && <p className="text-xs text-muted">{hint}</p>}</div>
}

// a loss is a state, so it wears the status colour; the sign and the zero line carry it for anyone who can't see the hue
function NetBar(p: { x?: number; y?: number; width?: number; height?: number; payload?: { net: number } }) {
  const h = p.height ?? 0
  return <rect x={p.x} y={h < 0 ? (p.y ?? 0) + h : p.y} width={p.width} height={Math.abs(h)} rx={4} fill={(p.payload?.net ?? 0) < 0 ? 'var(--bad)' : 'var(--s2)'} />
}
function NetTip({ active, label, payload }: { active?: boolean; label?: string; payload?: { value?: number }[] }) {
  if (!active || !payload?.length) return null
  const v = payload[0].value ?? 0
  return <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-lg"><p className="font-semibold">{monthLabel(String(label))}</p><p className="num">{v < 0 ? 'Shortfall −' : 'Surplus +'}{rand0(v)}</p></div>
}
