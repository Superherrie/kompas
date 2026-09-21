import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useFinance } from '../context/FinanceContext'
import { fetchAll, getSetting, useLoad } from '../lib/data'
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
    const [claimable, unmatched, settled] = await Promise.all([
      fetchAll<Txn & { repaid_by: number | null }>(() => supabase.from('pf_v_txns').select('*').eq('claimable', true).order('txn_date', { ascending: false })),
      supabase.from('pf_v_txns').select('*').gt('amount', 0).neq('sub_name', 'Reimbursed by work').or(names.map(n => `description.ilike.%${n}%`).join(',')).order('txn_date', { ascending: false }),
      supabase.from('pf_v_txns').select('*').eq('sub_name', 'Reimbursed by work').order('txn_date', { ascending: false }),
    ])
    // pf_v_txns doesn't carry repaid_by — read the links straight from the table
    const { data: links } = await supabase.from('pf_transactions').select('id,repaid_by').not('repaid_by', 'is', null)
    const by = new Map((links ?? []).map(l => [l.id as number, l.repaid_by as number]))
    return {
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
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Not yet reimbursed" value={rand(outstanding)} hint={`${open.length} item${open.length === 1 ? '' : 's'}`} bad={outstanding > 0} />
        <Tile label="Oldest open item" value={oldest ? dayLabel(oldest).replace(/^\w+ /, '') : '—'} hint={oldest ? `${daysSince(oldest)} days ago` : 'nothing open'} />
        <Tile label="Company payments to match" value={String(data?.unmatched.length ?? 0)} hint={rand((data?.unmatched ?? []).reduce((s, p) => s + p.amount, 0))} />
        <Tile label="Reimbursed, last 12 months" value={rand(repaid12)} hint={`${data?.settled.length ?? 0} payments in total`} />
      </div>

      <Claims version={tick} onChanged={changed} />
      {open.length === 0 && <Card><p className="text-sm text-muted">Nothing outstanding — every claimable item has been reimbursed.</p></Card>}

      {byMonth.length > 1 && (
        <Card title="Open items by month" sub="The month the expense was paid">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {byMonth.map(([m, v]) => <div key={m} className="rounded-xl bg-surface-2 px-3 py-2"><p className="text-xs text-muted">{monthLabel(m)}</p><p className="num font-semibold">{rand(v.v)}</p><p className="text-[11px] text-muted">{v.n} item{v.n === 1 ? '' : 's'}</p></div>)}
          </div>
        </Card>
      )}

      <Card title="Company payments not matched yet" sub="Money in from the company that hasn’t been tied to claimable items. Usually the payment also covers expenses you haven’t ticked “claim” yet — tick them, then press Match company payments.">
        {!data?.unmatched.length && <p className="text-sm text-muted">None.</p>}
        <div className="divide-y divide-line">
          {data?.unmatched.map(p => (
            <div key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0"><span className="block truncate font-medium">{p.description}</span><span className="text-xs text-muted">{dayLabel(p.txn_date)} · {p.account} · {p.sub_name}</span></span>
              <span className="num font-semibold text-good whitespace-nowrap">+{rand(p.amount)}</span>
            </div>
          ))}
        </div>
      </Card>

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
