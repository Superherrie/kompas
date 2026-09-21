import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { getSetting, useLoad } from '../lib/data'
import { matchClaims, type ClaimMatch, type MatchResult } from '../lib/claimMatch'
import { dayLabel, rand, today } from '../lib/format'
import { Card } from './Charts'
import Icon from './Icon'

interface Claim { txn_id: number | null; slip_id: number | null; claim_date: string; description: string; amount: number; claimed_on: string | null; repaid_on: string | null }

/** What work still owes: every claimable payment or slip that hasn't been repaid, oldest first.
 *  `version` is any value that changes when the caller's data changes, so the card reloads with it. */
export default function Claims({ version, onChanged }: { version: unknown; onChanged: () => void }) {
  const { data: open, reload } = useLoad(async () => {
    const { data, error } = await supabase.from('pf_v_claims').select('*').is('repaid_on', null).order('claim_date')
    if (error) throw new Error(error.message)
    return (data as Claim[]).map(c => ({ ...c, amount: +c.amount }))
  }, [version])
  const [result, setResult] = useState<MatchResult & { ticked: number }>(); const [busy, setBusy] = useState(false)

  /** line the company's payments up against the open claims; tick off the sure ones, offer the rest */
  async function matchPayments() {
    setBusy(true)
    const names = ((await getSetting('claim_payers')) ?? 'interconnect systems,asi connect').split(',').map(n => n.trim()).filter(Boolean)
    const [items, pays] = await Promise.all([
      supabase.from('pf_v_txns').select('id,txn_date,description,amount').eq('claimable', true).is('repaid_on', null),
      supabase.from('pf_v_txns').select('id,txn_date,description,amount').gt('amount', 0).neq('sub_name', 'Reimbursed by work').or(names.map(n => `description.ilike.%${n}%`).join(',')),
    ])
    const r = matchClaims(
      (items.data ?? []).map(t => ({ id: t.id, date: t.txn_date, amount: -t.amount, description: t.description })),
      (pays.data ?? []).map(t => ({ id: t.id, date: t.txn_date, amount: +t.amount, description: t.description })))
    let ticked = 0
    for (const m of r.matches.filter(x => x.sure)) { const { data } = await supabase.rpc('pf_settle_claims', { p_payment: m.payment.id, p_items: m.items.map(i => i.id) }); ticked += data ?? 0 }
    setResult({ ...r, ticked }); setBusy(false); void reload(); onChanged()
  }
  async function confirm(m: ClaimMatch) {
    await supabase.rpc('pf_settle_claims', { p_payment: m.payment.id, p_items: m.items.map(i => i.id) })
    setResult(r => r && { ...r, matches: r.matches.filter(x => x !== m), ticked: r.ticked + m.items.length }); void reload(); onChanged()
  }

  if (!open?.length && !result) return null

  const list = open ?? []
  const todo = list.filter(c => !c.claimed_on), waiting = list.filter(c => c.claimed_on)
  const sum = (a: Claim[]) => a.reduce((t, c) => t + c.amount, 0)
  const stamp = async (c: Claim, what: 'claimed' | 'repaid', on: boolean) => {
    await supabase.rpc('pf_stamp_claim', { p_txn: c.txn_id, p_slip: c.slip_id, p_what: what, p_date: on ? today() : null })
    void reload(); onChanged()
  }
  const claimAll = async () => { for (const c of todo) await supabase.rpc('pf_stamp_claim', { p_txn: c.txn_id, p_slip: c.slip_id, p_what: 'claimed', p_date: today() }); void reload(); onChanged() }

  return (
    <Card title="To claim from work" sub={`${rand(sum(todo))} still to hand in${waiting.length ? ` · ${rand(sum(waiting))} claimed, waiting to be repaid` : ''}`}
      right={<div className="flex flex-wrap justify-end gap-2">
        <button className="btn btn-primary !py-1.5 !text-xs" disabled={busy} onClick={() => void matchPayments()}>{busy ? 'Matching…' : 'Match company payments'}</button>
        {todo.length > 1 && <button className="btn btn-ghost !py-1.5 !text-xs" onClick={() => void claimAll()}>Mark all as claimed</button>}
      </div>}>
      {result && (
        <div className="rounded-2xl bg-surface-2 p-3 mb-3 text-sm space-y-2">
          <p><b>{result.ticked}</b> item{result.ticked === 1 ? '' : 's'} ticked off against company payments.{result.ticked === 0 && result.matches.length === 0 ? ' Nothing new to match.' : ''}</p>
          {result.matches.filter(m => !m.sure).map(m => (
            <div key={m.payment.id} className="border-t border-line pt-2">
              <p className="font-medium">Possible: {m.payment.description} · {dayLabel(m.payment.date)} · {rand(m.payment.amount)}</p>
              <p className="text-xs text-muted">{m.items.map(i => `${i.description.slice(0, 22)} ${rand(i.amount)}`).join(' + ')} — differs by {rand(m.difference)} (exchange rate?)</p>
              <button className="chip !bg-pine !text-surface mt-1" onClick={() => void confirm(m)}>Yes, tick these off</button>
            </div>
          ))}
          {result.unmatchedPayments.filter(u => u.amount < 20000).length > 0 && (
            <p className="text-xs text-muted border-t border-line pt-2">Company payments that don’t add up to flagged items (probably include expenses not ticked “claim” yet): {result.unmatchedPayments.filter(u => u.amount < 20000).map(u => `${dayLabel(u.date)} ${rand(u.amount)}`).join(' · ')}</p>
          )}
        </div>
      )}
      <div className="divide-y divide-line">
        {list.map(c => (
          <div key={`${c.txn_id}-${c.slip_id}`} className="flex items-center gap-2 py-2">
            <span className="flex-1 min-w-0">
              <span className="block truncate text-sm font-medium">{c.description}{c.slip_id && <Icon name="receipt" size={13} className="inline ml-1.5 text-muted" />}</span>
              <span className="text-xs text-muted">{dayLabel(c.claim_date)}{c.claimed_on ? ` · claimed ${dayLabel(c.claimed_on)}` : ''}</span>
            </span>
            <span className="num text-sm font-semibold">{rand(c.amount)}</span>
            {c.claimed_on
              ? <button className="chip !bg-pine !text-surface" onClick={() => void stamp(c, 'repaid', true)} title="Work has paid this back">Mark repaid</button>
              : <button className="chip !bg-gold/25 !text-ink" onClick={() => void stamp(c, 'claimed', true)} title="Handed in to work">Mark claimed</button>}
            {c.claimed_on && <button className="text-muted p-1" onClick={() => void stamp(c, 'claimed', false)} title="Undo claimed"><Icon name="close" size={14} /></button>}
          </div>
        ))}
      </div>
    </Card>
  )
}
