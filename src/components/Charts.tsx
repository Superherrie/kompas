import type { ReactNode } from 'react'
import { rand } from '../lib/format'

/** chart series slots (see index.css) — assign in this fixed order, never cycle; a 9th series folds into Other */
// eslint-disable-next-line react-refresh/only-export-components
export const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)']
// eslint-disable-next-line react-refresh/only-export-components
export const OTHER = 'var(--s-other)'
// eslint-disable-next-line react-refresh/only-export-components
export const AXIS = { tick: { fill: 'var(--muted)', fontSize: 11 }, axisLine: false, tickLine: false } as const
// eslint-disable-next-line react-refresh/only-export-components
export const GRID = { stroke: 'var(--line)', strokeDasharray: '0', vertical: false } as const

export function Card({ title, sub, right, children, className = '' }: { title?: string; sub?: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card p-5 ${className}`}>
      {(title || right) && (
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>{title && <h2 className="display text-lg leading-tight">{title}</h2>}{sub && <p className="text-xs text-muted mt-0.5">{sub}</p>}</div>
          {right}
        </div>
      )}
      {children}
    </section>
  )
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted mb-2">
      {items.map(i => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-0 border-t-[3px] rounded" style={{ borderColor: i.color, borderTopStyle: i.dashed ? 'dashed' : 'solid' }} />{i.label}
        </span>
      ))}
    </div>
  )
}

interface TipProps { active?: boolean; label?: string | number; payload?: { name?: string; value?: number; color?: string; dataKey?: string | number }[]; labelFormat?: (l: string) => string; total?: boolean }
/** shared tooltip: text in ink, a coloured swatch carries identity */
export function Tip({ active, label, payload, labelFormat, total }: TipProps) {
  if (!active || !payload?.length) return null
  const rows = payload.filter(p => p.value !== undefined && p.value !== null && p.value !== 0)
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold mb-1">{labelFormat ? labelFormat(String(label)) : label}</p>
      {rows.map(p => (
        <p key={String(p.dataKey)} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted"><span className="w-2 h-2 rounded-sm" style={{ background: p.color }} />{p.name}</span>
          <span className="num font-medium">{rand(p.value ?? 0)}</span>
        </p>
      ))}
      {total && rows.length > 1 && <p className="flex justify-between gap-4 border-t border-line mt-1 pt-1 font-semibold"><span>Total</span><span className="num">{rand(rows.reduce((s, p) => s + (p.value ?? 0), 0))}</span></p>}
    </div>
  )
}

/** progress ring for the month's discretionary budget; turns to the "bad" status colour when over */
export function Ring({ value, max, size = 220, children }: { value: number; max: number; size?: number; children?: ReactNode }) {
  const r = (size - 22) / 2, c = 2 * Math.PI * r, pct = max > 0 ? Math.min(value / max, 1) : 0, over = value > max && max > 0
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={14} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={over ? 'var(--bad)' : 'var(--s1)'} strokeWidth={14} strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`} style={{ transition: 'stroke-dasharray .6s ease' }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  )
}

/** horizontal magnitude bar with an optional reference tick (budget / usual) */
export function Bar({ value, max, color = 'var(--s1)', mark }: { value: number; max: number; color?: string; mark?: number }) {
  const w = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="relative h-2 rounded-full bg-surface-2">
      <div className="h-2 rounded-full" style={{ width: `${w}%`, background: color }} />
      {mark !== undefined && max > 0 && mark <= max && <span className="absolute -top-1 w-0.5 h-4 bg-ink/60 rounded" style={{ left: `${(mark / max) * 100}%` }} title={`usual ${rand(mark)}`} />}
    </div>
  )
}
