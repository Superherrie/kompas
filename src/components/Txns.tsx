import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { addMonths, dayLabel, monthLabel, rand } from '../lib/format'
import type { Category, Slip, Txn } from '../lib/types'
import Icon from './Icon'

export function Amount({ value, className = '' }: { value: number; className?: string }) {
  return <span className={`num font-semibold ${value > 0 ? 'text-good' : ''} ${className}`}>{value > 0 ? '+' : ''}{rand(value)}</span>
}

export function TxnRow({ t, onClick }: { t: Txn; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 py-2.5 text-left">
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: t.color ?? 'var(--muted)' }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{t.description}</span>
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <span className="truncate">{t.sub_name ?? 'Uncategorised'} · {t.account}{t.txn_time ? ` · ${t.txn_time.slice(0, 5)}` : ''}</span>
          {t.status === 'pending' && <span className="chip !py-0 !text-[10px] !bg-gold/25 !text-ink">pending</span>}
          {t.month !== t.cal_month && <span className="chip !py-0 !text-[10px] whitespace-nowrap">counts in {monthLabel(t.month, true)}</span>}
          {t.slip_id && <Icon name="receipt" size={13} />}
        </span>
      </span>
      <Amount value={t.amount} className="text-sm shrink-0" />
    </button>
  )
}

/** transactions grouped under day headings; tapping one opens the edit sheet */
export function TxnList({ txns, categories, onChanged, dayTotals = true }: { txns: Txn[]; categories: Category[]; onChanged: () => void; dayTotals?: boolean }) {
  const [open, setOpen] = useState<Txn>()
  const days = useMemo(() => {
    const m = new Map<string, Txn[]>()
    for (const t of txns) m.set(t.txn_date, [...(m.get(t.txn_date) ?? []), t])
    return [...m]
  }, [txns])
  if (!txns.length) return <p className="text-sm text-muted py-6 text-center">Nothing here.</p>
  return (
    <>
      {days.map(([d, rows]) => (
        <div key={d}>
          <div className="flex justify-between text-xs font-semibold uppercase tracking-wide text-muted pt-4 pb-1 border-b border-line">
            <span>{dayLabel(d)}</span>
            {dayTotals && <span className="num">{rand(rows.filter(r => r.kind === 'expense').reduce((s, r) => s + r.amount, 0))}</span>}
          </div>
          <div className="divide-y divide-line">{rows.map(t => <TxnRow key={t.id} t={t} onClick={() => setOpen(t)} />)}</div>
        </div>
      ))}
      {open && <TxnSheet t={open} categories={categories} onClose={() => setOpen(undefined)} onSaved={() => { setOpen(undefined); onChanged() }} />}
    </>
  )
}

export function CategorySelect({ categories, value, onChange }: { categories: Category[]; value: number | null; onChange: (id: number) => void }) {
  const parents = categories.filter(c => c.parent_id === null)
  return (
    <select className="input" value={value ?? ''} onChange={e => onChange(+e.target.value)}>
      <option value="" disabled>Choose a category…</option>
      {parents.map(p => (
        <optgroup key={p.id} label={p.name}>
          {categories.filter(c => c.parent_id === p.id).map(c => <option key={c.id} value={c.id}>{c.name}{c.discretionary ? ' ◦' : ''}</option>)}
        </optgroup>
      ))}
    </select>
  )
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  return (
    <div className="fixed inset-0 z-40 flex items-end md:items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-surface w-full md:max-w-lg rounded-t-3xl md:rounded-3xl p-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4"><h2 className="display text-xl">{title}</h2><button onClick={onClose} className="p-1 text-muted"><Icon name="close" /></button></div>
        {children}
      </div>
    </div>
  )
}

function TxnSheet({ t, categories, onClose, onSaved }: { t: Txn; categories: Category[]; onClose: () => void; onSaved: () => void }) {
  const [cat, setCat] = useState<number | null>(t.sub_id)
  const [remember, setRemember] = useState(true)
  const [note, setNote] = useState(t.note ?? '')
  const [period, setPeriod] = useState(t.month)
  const [slip, setSlip] = useState<Slip>(); const [img, setImg] = useState<string>()
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string>()

  useEffect(() => {
    if (!t.slip_id) return
    void supabase.from('pf_slips').select('*').eq('id', t.slip_id).maybeSingle().then(async ({ data }) => {
      setSlip(data as Slip)
      if (data?.image_path) { const { data: s } = await supabase.storage.from('pf-slips').createSignedUrl(data.image_path, 600); setImg(s?.signedUrl) }
    })
  }, [t.slip_id])

  async function save() {
    setBusy(true); setError(undefined)
    if (cat && cat !== t.sub_id) { const { error } = await supabase.rpc('pf_set_category', { p_txn: t.id, p_category: cat, p_remember: remember }); if (error) { setError(error.message); setBusy(false); return } }
    if (period !== t.month) await supabase.rpc('pf_set_period', { p_txn: t.id, p_period: period })
    if (note !== (t.note ?? '')) await supabase.from('pf_transactions').update({ note: note || null }).eq('id', t.id)
    onSaved()
  }
  async function remove() {
    if (!confirm('Remove this transaction?')) return
    await supabase.from('pf_transactions').delete().eq('id', t.id); onSaved()
  }

  return (
    <Sheet title={t.description} onClose={onClose}>
      <div className="flex items-baseline justify-between mb-4">
        <Amount value={t.amount} className="display text-3xl" />
        <span className="text-sm text-muted">{dayLabel(t.txn_date)}{t.txn_time ? ` · ${t.txn_time.slice(0, 5)}` : ''} · {t.account}</span>
      </div>
      <label className="block text-xs font-semibold text-muted mb-1">Category</label>
      <CategorySelect categories={categories} value={cat} onChange={setCat} />
      <label className="flex items-center gap-2 text-sm mt-2"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />Use this for every “{t.description.slice(0, 28)}”</label>
      <label className="block text-xs font-semibold text-muted mt-4 mb-1">Counts in</label>
      <select className="input" value={period} onChange={e => setPeriod(e.target.value)}>
        {[-1, 0, 1].map(k => addMonths(t.cal_month, k)).map(m => <option key={m} value={m}>{monthLabel(m)}{m === t.cal_month ? ' (the month it was paid)' : ''}</option>)}
        {t.period_locked && <option value="auto">Let the month-end rule decide</option>}
      </select>
      <label className="block text-xs font-semibold text-muted mt-4 mb-1">Note</label>
      <input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="What was this for?" />
      {slip && (
        <div className="mt-4 rounded-2xl bg-surface-2 p-3 text-sm">
          <p className="font-semibold mb-1 flex items-center gap-1.5"><Icon name="receipt" size={16} />Slip · {slip.merchant}</p>
          {slip.items?.map((i, k) => <div key={k} className="flex justify-between text-muted"><span className="truncate pr-3">{i.qty && i.qty !== 1 ? `${i.qty} × ` : ''}{i.name}</span><span className="num">{i.amount === null ? '' : rand(i.amount)}</span></div>)}
          {img && <a href={img} target="_blank" rel="noreferrer" className="text-pine font-semibold block mt-2">View photo</a>}
        </div>
      )}
      <p className="text-xs text-muted mt-3">Source: {t.source}{t.status === 'pending' ? ' — waiting for the bank statement to confirm it' : ''}</p>
      {error && <p className="text-sm text-bad mt-2">{error}</p>}
      <div className="flex gap-2 mt-5">
        <button className="btn btn-ghost !text-bad" onClick={() => void remove()}>Delete</button>
        <button className="btn btn-primary flex-1" disabled={busy} onClick={() => void save()}>Save</button>
      </div>
    </Sheet>
  )
}
