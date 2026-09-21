import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useFinance } from '../context/FinanceContext'
import { getSetting, setSetting, useLoad } from '../lib/data'
import { addMonths, rand0, thisMonth } from '../lib/format'
import { Card } from '../components/Charts'
import type { Member } from '../lib/types'

export default function Settings() {
  const { member, signOut } = useAuth()
  const { categories, monthly, budget, reload } = useFinance()
  const [draft, setDraft] = useState<string>()
  const [openCat, setOpenCat] = useState<number>()

  // six-month average per sub-category, so the discretionary switch shows what it moves
  const usual = useMemo(() => {
    const months = Array.from({ length: 6 }, (_, i) => addMonths(thisMonth(), -1 - i)); const m = new Map<number, number>()
    for (const r of monthly) if (r.kind === 'expense' && months.includes(r.month)) m.set(r.sub_id, (m.get(r.sub_id) ?? 0) - r.total / 6)
    return m
  }, [monthly])
  const discUsual = categories.filter(c => c.discretionary).reduce((s, c) => s + (usual.get(c.id) ?? 0), 0)

  async function saveBudget() { if (draft === undefined) return; await setSetting('discretionary_budget', String(Math.max(0, Math.round(+draft || 0)))); setDraft(undefined); void reload() }
  async function toggle(id: number, discretionary: boolean) { await supabase.from('pf_categories').update({ discretionary }).eq('id', id); void reload() }

  const parents = categories.filter(c => c.parent_id === null && c.kind === 'expense')
  return (
    <div className="space-y-5 max-w-3xl">
      <h1 className="display text-3xl md:text-4xl">Settings</h1>

      <Card title="Monthly discretionary budget" sub={`Your usual discretionary month is about ${rand0(discUsual)}.`}>
        <div className="flex gap-2 items-center">
          <span className="display text-2xl">R</span>
          <input className="input !w-40 num text-lg" inputMode="numeric" value={draft ?? String(budget)} onChange={e => setDraft(e.target.value.replace(/[^\d]/g, ''))} />
          <button className="btn btn-primary" disabled={draft === undefined} onClick={() => void saveBudget()}>Save</button>
        </div>
      </Card>

      <Card title="What counts as discretionary" sub="Switch on the spending you can choose not to do. The Today screen tracks exactly these.">
        <div className="divide-y divide-line">
          {parents.map(p => {
            const subs = categories.filter(c => c.parent_id === p.id); const on = subs.filter(s => s.discretionary).length
            return (
              <div key={p.id} className="py-2">
                <button className="w-full flex items-center justify-between text-left py-1" onClick={() => setOpenCat(openCat === p.id ? undefined : p.id)}>
                  <span className="flex items-center gap-2 font-medium"><span className="w-2.5 h-2.5 rounded-full" style={{ background: p.color ?? 'var(--muted)' }} />{p.name}</span>
                  <span className="text-xs text-muted">{on ? `${on} of ${subs.length} discretionary` : 'fixed'}</span>
                </button>
                {openCat === p.id && subs.map(s => (
                  <label key={s.id} className="flex items-center justify-between gap-3 pl-5 py-1.5 text-sm cursor-pointer">
                    <span>{s.name} <span className="text-xs text-muted num">· usual {rand0(usual.get(s.id) ?? 0)}</span></span>
                    <input type="checkbox" className="w-5 h-5 accent-[var(--pine)]" checked={s.discretionary} onChange={e => void toggle(s.id, e.target.checked)} />
                  </label>
                ))}
              </div>
            )
          })}
        </div>
      </Card>

      <MonthEnd onChanged={() => void reload()} />

      <SlipReader />

      <Household isOwner={member?.role === 'owner'} />

      <Card title="Signed in" sub={member?.email ?? ''}><button className="btn btn-ghost" onClick={() => void signOut()}>Sign out</button></Card>
    </div>
  )
}

function Household({ isOwner }: { isOwner: boolean }) {
  const { data: members, reload } = useLoad(async () => ((await supabase.from('pf_members').select('*').order('created_at')).data ?? []) as Member[], [])
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [msg, setMsg] = useState<string>(); const [busy, setBusy] = useState(false)
  async function add() {
    setBusy(true); setMsg(undefined)
    const { data, error } = await supabase.functions.invoke('pf-invite', { body: { name, email } })
    if (error || data?.error) setMsg(data?.error ?? error?.message)
    else { setMsg(data.status === 'created' ? `Login created. Temporary password: ${data.temp_password} — pass it on and ask them to change it.` : 'Added — they can sign in with their existing password.'); setName(''); setEmail(''); void reload() }
    setBusy(false)
  }
  async function remove(m: Member) { if (confirm(`Remove ${m.display_name} from the household? Their login stays, but Kompas closes to them.`)) { await supabase.from('pf_members').delete().eq('user_id', m.user_id); void reload() } }
  return (
    <Card title="Household" sub="Only these people can open Kompas — everyone sees the same accounts.">
      <div className="divide-y divide-line mb-3">
        {members?.map(m => <div key={m.user_id} className="flex items-center justify-between py-2 text-sm"><span><span className="font-medium">{m.display_name}</span> <span className="text-muted">· {m.email}</span></span>{m.role === 'owner' ? <span className="chip">owner</span> : isOwner && <button className="text-bad text-xs font-semibold" onClick={() => void remove(m)}>Remove</button>}</div>)}
      </div>
      {isOwner && (
        <div className="grid sm:grid-cols-[1fr_1.4fr_auto] gap-2">
          <input className="input" placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
          <input className="input" type="email" placeholder="E-mail" value={email} onChange={e => setEmail(e.target.value)} />
          <button className="btn btn-primary" disabled={busy || !name || !email} onClick={() => void add()}>Add</button>
        </div>
      )}
      {msg && <p className="text-sm mt-3 rounded-xl bg-surface-2 p-3">{msg}</p>}
    </Card>
  )
}

const READERS = [
  { v: 'device', title: 'On this device · free', text: 'Read on your phone, nothing sent anywhere. You confirm the shop, total and date before saving.' },
  { v: 'claude', title: 'Claude · about 50c (ZAR) a slip', text: 'Much better on crumpled or faded slips and line items. Needs ANTHROPIC_API_KEY set on the Supabase project.' },
]

function SlipReader() {
  const { data: reader, reload } = useLoad(() => getSetting('slip_reader'), [])
  const set = async (v: string) => { await setSetting('slip_reader', v); void reload() }
  return (
    <Card title="Slip reader" sub="How a photographed slip is turned into shop, total and items.">
      <div className="grid sm:grid-cols-2 gap-3">
        {READERS.map(r => (
          <button key={r.v} onClick={() => void set(r.v)} className={`text-left rounded-2xl border p-3 ${(reader ?? 'device') === r.v ? 'border-pine bg-pine/10' : 'border-line'}`}>
            <p className="font-semibold text-sm">{r.title}</p><p className="text-xs text-muted mt-0.5">{r.text}</p>
          </button>
        ))}
      </div>
    </Card>
  )
}

function MonthEnd({ onChanged }: { onChanged: () => void }) {
  const { data: day, reload } = useLoad(() => getSetting('month_end_cutoff_day'), [])
  const [draft, setDraft] = useState<string>(); const [msg, setMsg] = useState<string>()
  async function save() {
    const d = Math.max(0, Math.min(31, +(draft ?? 0)))
    await setSetting('month_end_cutoff_day', String(d || 99))                     // 99 = never reached → rule off
    const { data } = await supabase.rpc('pf_assign_periods')
    setMsg(`${data ?? 0} transactions moved.`); setDraft(undefined); void reload(); onChanged()
  }
  return (
    <Card title="Month-end payments" sub="Salary and the payments that go off FNB with it (alimony, bond, phones…) are next month’s money. FNB transactions from this day of the month onward count in the following month — or from payday, when the salary lands earlier (December). Discovery card spend always stays on its own date. Any single transaction can be changed by hand under “Counts in”.">
      <div className="flex gap-2 items-center text-sm">
        <span>From the</span>
        <input className="input !w-20 num text-center" inputMode="numeric" value={draft ?? (day === '99' ? '' : day ?? '27')} onChange={e => setDraft(e.target.value.replace(/[^d]/g, ''))} placeholder="off" />
        <span>th</span>
        <button className="btn btn-primary ml-2" disabled={draft === undefined} onClick={() => void save()}>Save</button>
      </div>
      {msg && <p className="text-sm text-muted mt-2">{msg}</p>}
    </Card>
  )
}
