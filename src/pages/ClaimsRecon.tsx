import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useFinance } from '../context/FinanceContext'
import { fetchAll, getSetting, setSetting, useLoad } from '../lib/data'
import { addMonths, dayLabel, monthLabel, rand, today } from '../lib/format'
import { Card } from '../components/Charts'
import Claims from '../components/Claims'
import type { Txn } from '../lib/types'

/** Work claims in one place: what is still owed (the Claims card), company payments that haven't been tied to
 *  anything yet, and what has been settled — each settlement showing the payment, its items and the FX difference. */
export default function ClaimsRecon() {
  const { reload: reloadFinance } = useFinance()
  const [tick, setTick] = useState(0)
  const changed = () => { setTick(t => t + 1); void reloadFinance() }

  const { data } = useLoad(async () => {
    const names = ((await getSetting('claim_payers')) ?? 'interconnect systems,asi connect').split(',').map(n => n.trim()).filter(Boolean)
    const start = (await getSetting('claims_start_date')) || '1900-01-01'
    const [claimable, unmatched, settled] = await Promise.all([
      fetchAll<Txn & { repaid_by: number | null }>(() => supabase.from('pf_v_txns').select('*').eq('claimable', true).gte('txn_date', start).order('txn_date', { ascending: false })),
      supabase.from('pf_v_txns').select('*').gt('amount', 0).gte('txn_date', start).neq('sub_name', 'Reimbursed by work').or(names.map(n => `description.ilike.%${n}%`).join(',')).order('txn_date', { ascending: false }),
      supabase.from('pf_v_txns').select('*').eq('sub_name', 'Reimbursed by work').gte('txn_date', start).order('txn_date', { ascending: false }),
    ])
    // pf_v_txns doesn't carry repaid_by — read the links straight from the table
    const { data: links } = await supabase.from('pf_transactions').select('id,repaid_by').not('repaid_by', 'is', null)
    const by = new Map((links ?? []).map(l => [l.id as number, l.repaid_by as number]))
    return {
      start,
      items: claimable.map(t => ({ ...t, amount: +t.amount, repaid_by: by.get(t.id) ?? null })),
      unmatched: ((unmatched.data ?? []) as Txn[]).map(t => ({ ...t, amount: +t.amount })),
      settled: ((settled.data ?? []) as Txn[]).map(t => ({ ...t, amount: +t.amount })),
    }
  }, [tick])

  const open = useMemo(() => (data?.items ?? []).filter(i => !i.repaid_on), [data])
  const outstanding = -open.reduce((s, i) => s + i.amount, 0)
  const oldest = open.length ? open[open.length - 1].txn_date : undefined
  const now = today(), yearAgo = `${addMonths(now.slice(0, 7), -12)}${now.slice(7)}`
  const daysSince = (d: string) => Math.round((Date.parse(now) - Date.parse(d)) / 86400_000)
  const repaid12 = (data?.settled ?? []).filter(p => p.txn_date >= yearAgo).reduce((s, p) => s + p.amount, 0)
  // open items by the month they were paid, so a missed month stands out
  const byMonth = useMemo(() => {
    const m = new Map<string, { n: number; v: number }>()
    for (const i of open) { const e = m.get(i.cal_month) ?? { n: 0, v: 0 }; e.n++; e.v -= i.amount; m.set(i.cal_month, e) }
    return [...m].sort((a, b) => b[0].localeCompare(a[0]))
  }, [open])

  async function undo(paymentId: number) {
    if (!confirm('Undo this settlement? Its items go back to “to claim” and the payment back to income.')) return
    await supabase.rpc('pf_unsettle_claims', { p_payment: paymentId }); changed()
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="display text-3xl md:text-4xl">Claims recon</h1>
        <p className="text-sm text-muted mt-1">Everything you’ve ticked “claim back from work”, until the company has paid it back.</p>
        <StartDate value={data?.start} onSaved={changed} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Not yet reimbursed" value={rand(outstanding)} hint={`${open.length} item${open.length === 1 ? '' : 's'}`} bad={outstanding > 0} />
        <Tile label="Oldest open item" value={oldest ? dayLabel(oldest).replace(/^\w+ /, '') : '—'} hint={oldest ? `${daysSince(oldest)} days ago` : 'nothing open'} />
        <Tile label="Company payments to match" value={String(data?.unmatched.length ?? 0)} hint={rand((data?.unmatched ?? []).reduce((s, p) => s + p.amount, 0))} />
        <Tile label="Reimbursed since the start date" value={rand(repaid12)} hint={`${data?.settled.length ?? 0} payments in total`} />
      </div>

      <ManualRecon payments={data?.unmatched ?? []} items={open} onSettled={changed} />

      <Claims version={tick} onChanged={changed} />
      {open.length === 0 && <Card><p className="text-sm text-muted">Nothing outstanding — every claimable item has been reimbursed.</p></Card>}

      {byMonth.length > 1 && (
        <Card title="Open items by month" sub="The month the expense was paid">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {byMonth.map(([m, v]) => <div key={m} className="rounded-xl bg-surface-2 px-3 py-2"><p className="text-xs text-muted">{monthLabel(m)}</p><p className="num font-semibold">{rand(v.v)}</p><p className="text-[11px] text-muted">{v.n} item{v.n === 1 ? '' : 's'}</p></div>)}
          </div>
        </Card>
      )}

      <Card title="Settled" sub="Each company payment with the items it paid back. The difference is the exchange rate on foreign-currency items.">
        {!data?.settled.length && <p className="text-sm text-muted">Nothing settled yet.</p>}
        <div className="space-y-3">
          {data?.settled.map(p => {
            const its = (data.items ?? []).filter(i => i.repaid_by === p.id); const cost = -its.reduce((s, i) => s + i.amount, 0); const diff = p.amount - cost
            return (
              <div key={p.id} className="rounded-2xl border border-line p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-semibold">{dayLabel(p.txn_date)} · {p.description}</span>
                  <span className="num font-semibold text-good">+{rand(p.amount)}</span>
                </div>
                {its.map(i => <div key={i.id} className="flex justify-between gap-3 text-sm text-muted pl-3"><span className="truncate">{dayLabel(i.txn_date)} · {i.description}</span><span className="num">{rand(i.amount)}</span></div>)}
                <div className="flex items-center justify-between mt-1.5 text-xs text-muted">
                  <span>{its.length} item{its.length === 1 ? '' : 's'} · cost {rand(cost)}{Math.abs(diff) >= 1 ? ` · ${diff < 0 ? 'short-paid' : 'over-paid'} ${rand(diff)}` : ' · exact'}</span>
                  <button className="underline" onClick={() => void undo(p.id)}>Undo</button>
                </div>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}

function Tile({ label, value, hint, bad }: { label: string; value: string; hint?: string; bad?: boolean }) {
  return <div className="card px-4 py-3"><p className="text-xs text-muted">{label}</p><p className={`display text-2xl num ${bad ? 'text-bad' : ''}`}>{value}</p>{hint && <p className="text-xs text-muted">{hint}</p>}</div>
}

/** take-on date: claims and company payments before it are left alone (they can't be reconciled any more) */
function StartDate({ value, onSaved }: { value?: string; onSaved: () => void }) {
  const [draft, setDraft] = useState<string>()
  if (!value) return null
  return (
    <p className="text-xs text-muted mt-2 flex flex-wrap items-center gap-2">
      Reconciling from
      <input type="date" className="input !w-auto !py-1 !text-xs" value={draft ?? (value === '1900-01-01' ? '' : value)} onChange={e => setDraft(e.target.value)} />
      {draft !== undefined && draft !== value && <button className="chip !bg-pine !text-surface" onClick={() => void setSetting('claims_start_date', draft).then(() => { setDraft(undefined); onSaved() })}>Save</button>}
      <span>— older items keep their “claim” tick (still outside your spending) but are ignored here.</span>
    </p>
  )
}

/** Recon by hand: tick one reimbursement, tick the open expenses it paid for, watch the difference, settle. */
function ManualRecon({ payments, items, onSettled }: { payments: Txn[]; items: Txn[]; onSettled: () => void }) {
  const [pay, setPay] = useState<number>(); const [picked, setPicked] = useState<Set<number>>(new Set()); const [busy, setBusy] = useState(false)
  const payment = payments.find(x => x.id === pay)
  const chosen = items.filter(i => picked.has(i.id))
  const cost = -chosen.reduce((t, i) => t + i.amount, 0)
  const diff = (payment?.amount ?? 0) - cost
  const toggle = (id: number) => setPicked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const money = (n: number) => `R ${Math.abs(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/,/g, '.').replace(/\u00a0|\s/g, ' ')}`   // a recon needs the cents

  async function settle() {
    if (!payment || !chosen.length) return
    if (Math.abs(diff) >= 1 && !confirm(`The items differ from the payment by ${money(diff)}. Settle anyway? (Normal when an item was billed in dollars.)`)) return
    setBusy(true)
    await supabase.rpc('pf_settle_claims', { p_payment: payment.id, p_items: chosen.map(i => i.id) })
    setBusy(false); setPay(undefined); setPicked(new Set()); onSettled()
  }

  if (!payments.length && !items.length) return null
  return (
    <Card title="Reconcile a reimbursement" sub="Tick the payment you received, then tick the expenses it paid back. The difference updates as you go.">
      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted mb-1">1 · Reimbursement received</p>
          {!payments.length && <p className="text-sm text-muted py-2">No unmatched company payments since the start date.</p>}
          <div className="divide-y divide-line">
            {payments.map(x => (
              <label key={x.id} className={`flex items-center gap-3 py-2 cursor-pointer ${pay === x.id ? 'bg-pine/10 -mx-2 px-2 rounded-xl' : ''}`}>
                <input type="radio" name="recon-payment" className="w-5 h-5 accent-[var(--pine)]" checked={pay === x.id} onChange={() => setPay(x.id)} />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{x.description}</span><span className="text-xs text-muted">{dayLabel(x.txn_date)} · {x.account}</span></span>
                <span className="num text-sm font-semibold text-good whitespace-nowrap">+{money(x.amount)}</span>
              </label>
            ))}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">2 · Expenses it paid back</p>
            {items.length > 0 && <button className="text-xs underline text-muted" onClick={() => setPicked(picked.size === items.length ? new Set() : new Set(items.map(i => i.id)))}>{picked.size === items.length ? 'Clear' : 'Tick all'}</button>}
          </div>
          {!items.length && <p className="text-sm text-muted py-2">No open claimable expenses. Tick “claim” on a transaction first.</p>}
          <div className="divide-y divide-line">
            {items.map(i => (
              <label key={i.id} className={`flex items-center gap-3 py-2 cursor-pointer ${picked.has(i.id) ? 'bg-pine/10 -mx-2 px-2 rounded-xl' : ''}`}>
                <input type="checkbox" className="w-5 h-5 accent-[var(--pine)]" checked={picked.has(i.id)} onChange={() => toggle(i.id)} />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{i.description}</span><span className="text-xs text-muted">{dayLabel(i.txn_date)} · {i.account}</span></span>
                <span className="num text-sm font-semibold whitespace-nowrap">{money(i.amount)}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="sticky bottom-20 md:bottom-4 mt-4 rounded-2xl border border-line bg-surface shadow-lg p-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <Figure label="Reimbursement" value={payment ? money(payment.amount) : '—'} />
        <Figure label={`Expenses ticked (${chosen.length})`} value={chosen.length ? money(cost) : '—'} />
        <Figure label="Difference" value={payment && chosen.length ? `${diff < 0 ? '−' : diff > 0 ? '+' : ''}${money(diff)}` : '—'}
          tone={!payment || !chosen.length ? undefined : Math.abs(diff) < 1 ? 'good' : 'bad'}
          hint={!payment || !chosen.length ? undefined : Math.abs(diff) < 1 ? 'balances' : diff < 0 ? 'paid back less than the expenses' : 'paid back more than the expenses'} />
        <button className="btn btn-primary ml-auto" disabled={!payment || !chosen.length || busy} onClick={() => void settle()}>{busy ? 'Settling…' : 'Settle these'}</button>
      </div>
    </Card>
  )
}

function Figure({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'good' | 'bad' }) {
  return <div><p className="text-[11px] text-muted">{label}</p><p className={`num font-semibold text-lg leading-tight ${tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : ''}`}>{value}</p>{hint && <p className="text-[11px] text-muted">{hint}</p>}</div>
}
