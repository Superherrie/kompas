import { supabase } from '../lib/supabase'
import { useLoad } from '../lib/data'
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
  if (!open?.length) return null

  const todo = open.filter(c => !c.claimed_on), waiting = open.filter(c => c.claimed_on)
  const sum = (a: Claim[]) => a.reduce((t, c) => t + c.amount, 0)
  const stamp = async (c: Claim, what: 'claimed' | 'repaid', on: boolean) => {
    await supabase.rpc('pf_stamp_claim', { p_txn: c.txn_id, p_slip: c.slip_id, p_what: what, p_date: on ? today() : null })
    void reload(); onChanged()
  }
  const claimAll = async () => { for (const c of todo) await supabase.rpc('pf_stamp_claim', { p_txn: c.txn_id, p_slip: c.slip_id, p_what: 'claimed', p_date: today() }); void reload(); onChanged() }

  return (
    <Card title="To claim from work" sub={`${rand(sum(todo))} still to hand in${waiting.length ? ` · ${rand(sum(waiting))} claimed, waiting to be repaid` : ''}`}
      right={todo.length > 1 ? <button className="btn btn-ghost !py-1.5 !text-xs" onClick={() => void claimAll()}>Mark all as claimed</button> : undefined}>
      <div className="divide-y divide-line">
        {open.map(c => (
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
