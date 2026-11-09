import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useLoad } from '../lib/data'
import { dayLabel, rand0, today } from '../lib/format'
import { Card } from '../components/Charts'
import { Sheet } from '../components/Txns'
import Icon from '../components/Icon'

/** a row of pf_balance_sheet(as_of): an item with its latest valuation on or before that date */
interface Row { item_id: number; name: string; side: 'asset' | 'liability'; grp: string; sort: number; note: string | null; account_id: number | null; as_of: string | null; value: number | null; signed: number | null; source: string | null; stale_days: number | null }
interface Valuation { id: number; as_of: string; value: number; source: string | null }

const GROUPS = { asset: ['Cash & bank', 'Investments', 'Retirement', 'Property', 'Vehicles', 'Other assets'], liability: ['Home loans', 'Vehicle finance', 'Cards & overdrafts', 'Other liabilities'] }
const STALE_DAYS = 120

/** What Herman owns and owes, as at a date. Values are captured by hand from statements (each with its date and source);
 *  the sheet shows the latest value on or before the chosen date and flags figures older than four months. */
export default function Balance() {
  const [asOf, setAsOf] = useState(today())
  const { data: rows, loading, reload } = useLoad(async () => {
    const { data, error } = await supabase.rpc('pf_balance_sheet', { p_as_of: asOf })
    if (error) throw new Error(error.message)
    return (data as Row[]).map(r => ({ ...r, value: r.value === null ? null : +r.value, signed: r.signed === null ? null : +r.signed }))
  }, [asOf])
  const [open, setOpen] = useState<Row>()
  const [adding, setAdding] = useState(false)

  const { groups, assets, liabilities, missing } = useMemo(() => {
    const list = rows ?? []
    const groups = (['asset', 'liability'] as const).map(side => ({
      side,
      blocks: GROUPS[side].map(g => ({ name: g, rows: list.filter(r => r.side === side && r.grp === g), total: list.filter(r => r.side === side && r.grp === g).reduce((s, r) => s + (r.value ?? 0), 0) })).filter(b => b.rows.length),
    }))
    const assets = list.filter(r => r.side === 'asset').reduce((s, r) => s + (r.value ?? 0), 0)
    const liabilities = list.filter(r => r.side === 'liability').reduce((s, r) => s + (r.value ?? 0), 0)
    return { groups, assets, liabilities, missing: list.filter(r => r.value === null).length }
  }, [rows])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-3xl md:text-4xl">Balance sheet</h1>
          <p className="text-sm text-muted mt-1">What you own and owe. Each figure carries the date and the document it came from; tap a line to add a newer value.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted">as at</label>
          <input type="date" className="input !w-auto !py-1.5 text-sm" value={asOf} max={today()} onChange={e => e.target.value && setAsOf(e.target.value)} />
          <button className="btn btn-primary !py-1.5 !text-xs" onClick={() => setAdding(true)}><Icon name="plus" size={14} />Add item</button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Tile label="Assets" value={rand0(assets)} />
        <Tile label="Liabilities" value={rand0(liabilities)} tone="bad" />
        <Tile label="Net worth" value={rand0(assets - liabilities)} tone={assets >= liabilities ? 'good' : 'bad'} big />
      </div>
      {missing > 0 && <p className="text-xs text-gold font-semibold">{missing} line{missing === 1 ? '' : 's'} still without a value — they count as R 0 until a statement figure is captured.</p>}

      {loading && !rows ? <p className="text-sm text-muted py-6 text-center">Loading…</p> : groups.map(g => (
        <Card key={g.side} title={g.side === 'asset' ? 'Assets' : 'Liabilities'} className="!p-0 overflow-hidden" right={<span className="num text-sm font-semibold">{rand0(g.side === 'asset' ? assets : liabilities)}</span>}>
          {g.blocks.map(b => (
            <div key={b.name}>
              <div className="flex justify-between px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted"><span>{b.name}</span><span className="num">{rand0(b.total)}</span></div>
              <div className="divide-y divide-line">
                {b.rows.map(r => (
                  <button key={r.item_id} onClick={() => setOpen(r)} className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {r.value === null ? 'no value yet' : <>{dayLabel(r.as_of!)}{r.source ? ` · ${r.source}` : ''}</>}
                      </span>
                    </span>
                    <span className="text-right shrink-0">
                      <span className={`num block text-sm font-semibold ${r.value === null ? 'text-muted' : ''}`}>{r.value === null ? '—' : rand0(r.value)}</span>
                      {r.value !== null && (r.stale_days ?? 0) > STALE_DAYS && <span className="chip !py-0 !text-[10px] !bg-gold/25 !text-ink">{Math.round((r.stale_days ?? 0) / 30)} months old</span>}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {!g.blocks.length && <p className="text-sm text-muted px-4 py-4">Nothing captured yet.</p>}
        </Card>
      ))}
      <p className="text-xs text-muted">Bank balances here are statement figures captured by hand; the day-to-day transactions live on the other tabs. A liability is shown as a positive amount and subtracted.</p>

      {open && <ItemSheet row={open} onClose={() => setOpen(undefined)} onChanged={() => { setOpen(undefined); void reload() }} />}
      {adding && <NewItemSheet onClose={() => setAdding(false)} onChanged={() => { setAdding(false); void reload() }} />}
    </div>
  )
}

function Tile({ label, value, tone, big }: { label: string; value: string; tone?: 'good' | 'bad'; big?: boolean }) {
  return (
    <div className="card !p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p className={`num font-semibold mt-0.5 ${big ? 'text-base md:text-2xl' : 'text-sm md:text-xl'} ${tone === 'bad' ? 'text-bad' : tone === 'good' ? 'text-good' : ''}`}>{value}</p>
    </div>
  )
}

/** one item: its valuation history, a form for a new value, and the item's own details */
function ItemSheet({ row, onClose, onChanged }: { row: Row; onClose: () => void; onChanged: () => void }) {
  const { data: history, reload } = useLoad(async () => (await supabase.from('pf_balance_values').select('id,as_of,value,source').eq('item_id', row.item_id).order('as_of', { ascending: false })).data as Valuation[] ?? [], [row.item_id])
  const [date, setDate] = useState(today()); const [value, setValue] = useState(''); const [source, setSource] = useState('')
  const [note, setNote] = useState(row.note ?? ''); const [busy, setBusy] = useState(false); const [error, setError] = useState<string>()
  const amount = parseFloat(value.replace(/[R\s,]/g, '').replace(',', '.'))

  async function addValue() {
    if (!(amount >= 0)) { setError('Enter the amount from the statement (a positive figure).'); return }
    setBusy(true); setError(undefined)
    const { error } = await supabase.from('pf_balance_values').upsert({ item_id: row.item_id, as_of: date, value: Math.round(amount * 100) / 100, source: source || null }, { onConflict: 'item_id,as_of' })
    setBusy(false); if (error) { setError(error.message); return }
    setValue(''); setSource(''); void reload(); onChanged()
  }
  async function saveNote() { await supabase.from('pf_balance_items').update({ note: note || null }).eq('id', row.item_id); onChanged() }
  async function archive() { if (!confirm(`Take "${row.name}" off the balance sheet? Its history is kept.`)) return; await supabase.from('pf_balance_items').update({ active: false }).eq('id', row.item_id); onChanged() }
  async function removeValue(v: Valuation) { if (!confirm(`Remove the value of ${rand0(v.value)} as at ${dayLabel(v.as_of)}?`)) return; await supabase.from('pf_balance_values').delete().eq('id', v.id); void reload(); onChanged() }

  return (
    <Sheet title={row.name} onClose={onClose}>
      <p className="text-xs uppercase tracking-wide text-muted">{row.side === 'asset' ? 'Asset' : 'Liability'} · {row.grp}</p>
      <p className="display text-3xl num mt-1 mb-3">{row.value === null ? '—' : rand0(row.value)}</p>

      <div className="rounded-2xl bg-surface-2 p-3 mb-3">
        <p className="text-xs font-semibold text-muted mb-2">New value from a statement</p>
        <div className="grid grid-cols-2 gap-2">
          <input type="date" className="input" value={date} max={today()} onChange={e => setDate(e.target.value)} />
          <input className="input num" inputMode="decimal" placeholder="Amount (R)" value={value} onChange={e => setValue(e.target.value)} />
        </div>
        <input className="input mt-2" placeholder="Source, e.g. Absa statement Feb 2026" value={source} onChange={e => setSource(e.target.value)} />
        {error && <p className="text-xs text-bad mt-2">{error}</p>}
        <button className="btn btn-primary w-full mt-2" disabled={busy} onClick={() => void addValue()}>Save value</button>
      </div>

      <p className="text-xs font-semibold text-muted mb-1">History</p>
      <div className="divide-y divide-line rounded-2xl border border-line mb-3">
        {(history ?? []).map(v => (
          <div key={v.id} className="flex items-center gap-2 px-3 py-2 text-sm">
            <span className="w-24 shrink-0 text-muted text-xs">{dayLabel(v.as_of)}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted">{v.source ?? ''}</span>
            <span className="num font-semibold">{rand0(v.value)}</span>
            <button className="text-muted hover:text-bad" title="Remove this value" onClick={() => void removeValue(v)}><Icon name="close" size={14} /></button>
          </div>
        ))}
        {history && !history.length && <p className="px-3 py-3 text-sm text-muted">No values yet.</p>}
      </div>

      <label className="block text-xs font-semibold text-muted mb-1">Note</label>
      <input className="input" value={note} onChange={e => setNote(e.target.value)} onBlur={() => void saveNote()} placeholder="Account number ending, terms, what it is…" />
      <div className="flex justify-between mt-4">
        <button className="btn btn-ghost !text-bad" onClick={() => void archive()}>Remove from sheet</button>
        <button className="btn btn-ghost" onClick={onClose}>Done</button>
      </div>
    </Sheet>
  )
}

function NewItemSheet({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [side, setSide] = useState<'asset' | 'liability'>('asset')
  const [grp, setGrp] = useState(GROUPS.asset[0]); const [name, setName] = useState(''); const [note, setNote] = useState('')
  const [date, setDate] = useState(today()); const [value, setValue] = useState(''); const [source, setSource] = useState('')
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string>()
  const amount = parseFloat(value.replace(/[R\s,]/g, ''))
  async function save() {
    if (!name.trim()) { setError('Give it a name.'); return }
    setBusy(true); setError(undefined)
    const { data, error } = await supabase.from('pf_balance_items').insert({ name: name.trim(), side, grp, note: note || null, sort: 100 }).select('id').single()
    if (error || !data) { setBusy(false); setError(error?.message ?? 'Could not save'); return }
    if (amount >= 0 && value) await supabase.from('pf_balance_values').insert({ item_id: data.id, as_of: date, value: Math.round(amount * 100) / 100, source: source || null })
    setBusy(false); onChanged()
  }
  return (
    <Sheet title="Add to the balance sheet" onClose={onClose}>
      <div className="inline-flex rounded-full bg-surface-2 p-1 text-sm mb-3">
        {(['asset', 'liability'] as const).map(s => <button key={s} onClick={() => { setSide(s); setGrp(GROUPS[s][0]) }} className={`px-3 py-1 rounded-full font-medium ${side === s ? 'bg-surface shadow-sm' : 'text-muted'}`}>{s === 'asset' ? 'Asset' : 'Liability'}</button>)}
      </div>
      <label className="block text-xs font-semibold text-muted mb-1">Group</label>
      <select className="input" value={grp} onChange={e => setGrp(e.target.value)}>{GROUPS[side].map(g => <option key={g}>{g}</option>)}</select>
      <label className="block text-xs font-semibold text-muted mt-3 mb-1">Name</label>
      <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Ninety One unit trusts" />
      <label className="block text-xs font-semibold text-muted mt-3 mb-1">Note</label>
      <input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="Account ending, terms…" />
      <p className="text-xs font-semibold text-muted mt-4 mb-1">First value (optional)</p>
      <div className="grid grid-cols-2 gap-2">
        <input type="date" className="input" value={date} max={today()} onChange={e => setDate(e.target.value)} />
        <input className="input num" inputMode="decimal" placeholder="Amount (R)" value={value} onChange={e => setValue(e.target.value)} />
      </div>
      <input className="input mt-2" placeholder="Source" value={source} onChange={e => setSource(e.target.value)} />
      {error && <p className="text-xs text-bad mt-2">{error}</p>}
      <button className="btn btn-primary w-full mt-4" disabled={busy} onClick={() => void save()}>Add</button>
    </Sheet>
  )
}
