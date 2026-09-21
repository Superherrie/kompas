import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useFinance } from '../context/FinanceContext'
import { getSetting, useLoad } from '../lib/data'
import { readSlip, type SlipDraft } from '../lib/slipOcr'
import { dayLabel, rand, today } from '../lib/format'
import { Card } from '../components/Charts'
import { CategorySelect, Sheet } from '../components/Txns'
import Icon from '../components/Icon'
import type { Slip } from '../lib/types'

/** phone photos are 4–12 MB; 1800px JPEG is plenty for a till slip and keeps the upload and the read fast */
async function shrink(file: File, max = 1800): Promise<Blob> {
  const img = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const k = Math.min(1, max / Math.max(img.width, img.height))
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  return new Promise((ok, fail) => c.toBlob(b => b ? ok(b) : fail(new Error('could not process the photo')), 'image/jpeg', 0.85))
}

type Stage = { step: 'idle' } | { step: 'review'; draft: SlipDraft; blob: Blob; preview: string } | { step: 'working'; label: string; preview: string } | { step: 'done'; slip: Slip; txnId: number | null; created: boolean; preview: string } | { step: 'error'; message: string }

export default function Slips() {
  const { session } = useAuth()
  const { reload: reloadFinance } = useFinance()
  const { data: reader } = useLoad(() => getSetting('slip_reader'), [])
  const [sp, setSp] = useSearchParams()
  const input = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage>({ step: 'idle' })
  const [view, setView] = useState<Slip>()
  const { data: slips, reload } = useLoad(async () => {
    const { data, error } = await supabase.from('pf_slips').select('*').order('created_at', { ascending: false }).limit(60)
    if (error) throw new Error(error.message)
    return data as Slip[]
  }, [])

  // the camera button in the nav lands here with ?scan=1 → open the camera straight away
  useEffect(() => { if (sp.get('scan')) { input.current?.click(); setSp({}, { replace: true }) } }, [sp, setSp])

  async function onFile(file?: File) {
    if (!file || !session) return
    const preview = URL.createObjectURL(file)
    try {
      const blob = await shrink(file)
      if (reader !== 'claude') {
        setStage({ step: 'working', label: 'Reading the slip…', preview })
        const draft = await readSlip(file, pct => setStage({ step: 'working', label: `Reading the slip… ${pct}%`, preview }))
        setStage({ step: 'review', draft, blob, preview })
        if (input.current) input.current.value = ''
        return
      }
      setStage({ step: 'working', label: 'Uploading…', preview })
      const path = `${session.user.id}/${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`
      const up = await supabase.storage.from('pf-slips').upload(path, blob, { contentType: 'image/jpeg' })
      if (up.error) throw new Error(up.error.message)
      setStage({ step: 'working', label: 'Reading the slip…', preview })
      const { data, error } = await supabase.functions.invoke('pf-scan-slip', { body: { path } })
      if (error) { const body = await (error as { context?: Response }).context?.json?.().catch(() => null); throw new Error(body?.error ?? error.message) }
      if (data?.error) throw new Error(data.error)
      setStage({ step: 'done', slip: data.slip, txnId: data.txn_id, created: data.created, preview })
      void reload(); void reloadFinance()
    } catch (e) { setStage({ step: 'error', message: String((e as Error).message ?? e) }) }
    if (input.current) input.current.value = ''
  }

  async function saveDraft(d: SlipDraft & { category_id?: number | null; tip?: number }, blob: Blob, preview: string) {
    if (!session) return
    try {
      setStage({ step: 'working', label: 'Saving…', preview })
      const path = `${session.user.id}/${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`
      const up = await supabase.storage.from('pf-slips').upload(path, blob, { contentType: 'image/jpeg' })
      if (up.error) throw new Error(up.error.message)
      const { data, error } = await supabase.rpc('pf_file_slip', { p: { ...d, image_path: path, reader: 'device' } })
      if (error) throw new Error(error.message)
      const { data: slip } = await supabase.from('pf_slips').select('*').eq('id', data.slip_id).single()
      setStage({ step: 'done', slip: slip as Slip, txnId: data.txn_id, created: data.created, preview })
      void reload(); void reloadFinance()
    } catch (e) { setStage({ step: 'error', message: String((e as Error).message ?? e) }) }
  }

  return (
    <div className="space-y-5">
      <h1 className="display text-3xl md:text-4xl">Slips</h1>
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => void onFile(e.target.files?.[0])} />

      <Card className="text-center">
        {stage.step === 'idle' && (
          <div className="py-6">
            <div className="mx-auto w-16 h-16 rounded-full bg-coral/15 text-coral grid place-items-center mb-3"><Icon name="camera" size={30} /></div>
            <p className="font-semibold">Snap the slip before it goes in the bin</p>
            <p className="text-sm text-muted max-w-sm mx-auto mt-1 mb-4">Kompas reads the shop, total and line items on your phone, you check them, and it ties the slip to the card payment — so “Checkers R699” becomes what you actually bought.</p>
            <button className="btn btn-coral" onClick={() => input.current?.click()}><Icon name="camera" />Scan a slip</button>
          </div>
        )}
        {stage.step === 'working' && (
          <div className="py-4 flex flex-col items-center gap-3">
            <img src={stage.preview} alt="" className="h-40 rounded-xl object-cover opacity-70" />
            <p className="font-semibold animate-pulse">{stage.label}</p>
          </div>
        )}
        {stage.step === 'review' && <Review draft={stage.draft} preview={stage.preview} onCancel={() => setStage({ step: 'idle' })} onSave={d => void saveDraft(d, stage.blob, stage.preview)} />}
        {stage.step === 'error' && (
          <div className="py-6"><p className="text-bad font-semibold mb-1">That didn’t work</p><p className="text-sm text-muted mb-4">{stage.message}</p><button className="btn btn-ghost" onClick={() => setStage({ step: 'idle' })}>Try again</button></div>
        )}
        {stage.step === 'done' && (
          <div className="text-left sm:flex gap-5">
            <img src={stage.preview} alt="" className="h-44 rounded-xl object-cover mx-auto sm:mx-0 mb-3 sm:mb-0" />
            <div className="flex-1 min-w-0">
              {stage.slip.status === 'failed' ? <p className="text-bad font-semibold">Couldn’t read a total from that photo — try again with the whole slip flat and in the light.</p> : (
                <>
                  <p className="display text-2xl">{stage.slip.merchant}</p>
                  <p className="display text-3xl num">{rand(stage.slip.total ?? 0)}</p>
                  <p className="text-sm text-muted mb-2">{stage.slip.slip_date ? dayLabel(stage.slip.slip_date) : 'no date on slip'} · {stage.slip.items.length} item{stage.slip.items.length === 1 ? '' : 's'} · {stage.slip.payment_method}</p>
                  <p className="text-sm flex items-start gap-1.5"><Icon name="check" size={16} className="text-good mt-0.5 shrink-0" />
                    {stage.txnId && !stage.created && 'Matched to the card payment already on your account.'}
                    {stage.created && 'Added as a pending transaction — the bank’s notification will confirm it.'}
                    {!stage.txnId && (stage.slip.payment_method === 'cash' ? 'Cash slip saved (the ATM withdrawal already counts as the spend).' : 'Saved — no matching payment on record. Once the statement is imported, open the slip and tap “Look for the payment again”.')}
                  </p>
                </>
              )}
              <div className="flex gap-2 mt-4"><button className="btn btn-coral" onClick={() => { setStage({ step: 'idle' }); input.current?.click() }}>Scan another</button><button className="btn btn-ghost" onClick={() => setStage({ step: 'idle' })}>Done</button></div>
            </div>
          </div>
        )}
      </Card>

      <Card title="Recent slips">
        {!slips?.length && <p className="text-sm text-muted">No slips yet.</p>}
        <div className="divide-y divide-line">
          {slips?.map(s => (
            <button key={s.id} className="w-full flex items-center gap-3 py-2.5 text-left" onClick={() => setView(s)}>
              <Icon name="receipt" className="text-muted shrink-0" />
              <span className="flex-1 min-w-0"><span className="block truncate text-sm font-medium">{s.merchant ?? 'Unreadable slip'}</span><span className="text-xs text-muted">{s.slip_date ? dayLabel(s.slip_date) : '—'} · {s.items?.length ?? 0} items</span></span>
              <span className={`chip ${s.status === 'matched' ? '!bg-good/15 !text-good' : s.status === 'failed' ? '!bg-bad/15 !text-bad' : ''}`}>{s.status}</span>
              <span className="num text-sm font-semibold w-24 text-right">{s.total === null ? '' : rand(+s.total)}</span>
            </button>
          ))}
        </div>
      </Card>
      {view && <SlipSheet slip={view} onClose={() => setView(undefined)} onChanged={() => { setView(undefined); void reload(); void reloadFinance() }} />}
    </div>
  )
}

function SlipSheet({ slip, onClose, onChanged }: { slip: Slip; onClose: () => void; onChanged: () => void }) {
  const [img, setImg] = useState<string>()
  useEffect(() => { if (slip.image_path) void supabase.storage.from('pf-slips').createSignedUrl(slip.image_path, 600).then(({ data }) => setImg(data?.signedUrl)) }, [slip.image_path])
  async function rematch() { await supabase.rpc('pf_match_slip', { p_slip: slip.id }); onChanged() }
  async function remove() {
    if (!confirm('Delete this slip and its photo?')) return
    if (slip.image_path) await supabase.storage.from('pf-slips').remove([slip.image_path])
    await supabase.from('pf_slips').delete().eq('id', slip.id); onChanged()
  }
  return (
    <Sheet title={slip.merchant ?? 'Slip'} onClose={onClose}>
      <p className="display text-3xl num mb-1">{slip.total === null ? '—' : rand(+slip.total)}</p>
      <p className="text-sm text-muted mb-3">{slip.slip_date ? dayLabel(slip.slip_date) : 'no date'}{slip.slip_time ? ` · ${slip.slip_time.slice(0, 5)}` : ''} · {slip.payment_method}{slip.card_last4 ? ` ···${slip.card_last4}` : ''}</p>
      <div className="rounded-2xl bg-surface-2 p-3 text-sm mb-3">
        {slip.items?.length ? slip.items.map((i, k) => <div key={k} className="flex justify-between py-0.5"><span className="truncate pr-3">{i.qty && i.qty !== 1 ? `${i.qty} × ` : ''}{i.name}</span><span className="num">{i.amount === null ? '' : rand(i.amount)}</span></div>) : <p className="text-muted">No line items read.</p>}
        {slip.tip ? <div className="flex justify-between border-t border-line mt-1 pt-1"><span>Tip</span><span className="num">{rand(+slip.tip)}</span></div> : null}
      </div>
      {img && <img src={img} alt="Slip" className="rounded-2xl w-full mb-3" />}
      <div className="flex gap-2">
        <button className="btn btn-ghost !text-bad" onClick={() => void remove()}>Delete</button>
        {slip.status !== 'matched' && <button className="btn btn-ghost flex-1" onClick={() => void rematch()}>Look for the payment again</button>}
        {slip.status === 'matched' && <Link to="/transactions" className="btn btn-ghost flex-1">See transactions</Link>}
      </div>
    </Sheet>
  )
}

/** OCR is never certain on thermal paper — the three things that matter (shop, total, date) are confirmed by eye before saving */
function Review({ draft, preview, onSave, onCancel }: { draft: SlipDraft; preview: string; onSave: (d: SlipDraft & { category_id?: number | null; tip?: number }) => void; onCancel: () => void }) {
  const { categories } = useFinance()
  const [d, setD] = useState({ ...draft, date: draft.date ?? today() })
  const [total, setTotal] = useState(draft.total === null ? '' : draft.total.toFixed(2))
  const [cat, setCat] = useState<number | null>(null)
  const [tipText, setTipText] = useState('')
  const [showText, setShowText] = useState(false)
  const amount = parseFloat(total.replace(',', '.'))
  const tip = Math.max(0, parseFloat(tipText.replace(',', '.')) || 0)
  const paid = (amount || 0) + tip

  // look the payment up while the person is still checking the slip — also finds payments from months ago
  const [found, setFound] = useState<{ id: number; txn_date: string; description: string; amount: number; account: string; inferred_tip: number | null } | null>()
  useEffect(() => {
    if (!(paid > 0)) { setFound(undefined); return }
    const t = setTimeout(() => {
      void supabase.rpc('pf_find_payment', { p_amount: paid, p_date: d.date || null, p_merchant: d.merchant, p_infer_tip: tip === 0 })
        .then(({ data }) => setFound((data as typeof found[])?.[0] ?? null))
    }, 400)
    return () => clearTimeout(t)
  }, [paid, tip, d.date, d.merchant])
  const itemsSum = d.items.reduce((s, i) => s + (i.amount ?? 0), 0)
  return (
    <div className="text-left sm:flex gap-5">
      <a href={preview} target="_blank" rel="noreferrer" className="shrink-0"><img src={preview} alt="Slip" className="h-56 rounded-xl object-cover mx-auto sm:mx-0 mb-3 sm:mb-0" /></a>
      <div className="flex-1 min-w-0 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Check what was read</p>
        {draft.total === null && <p className="text-sm text-bad">Couldn’t find the total — type it in from the slip.</p>}
        <input className="input" placeholder="Shop" value={d.merchant} onChange={e => setD({ ...d, merchant: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">R</span><input className="input !pl-8 num font-semibold" inputMode="decimal" placeholder="Total" value={total} onChange={e => setTotal(e.target.value)} /></div>
          <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">Tip R</span><input className="input !pl-14 num" inputMode="decimal" placeholder="0" value={tipText} onChange={e => setTipText(e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3 items-center">
          <input className="input" type="date" value={d.date ?? ''} onChange={e => setD({ ...d, date: e.target.value })} />
          <p className="text-sm text-muted">Paid <span className="num font-semibold text-ink">{paid > 0 ? rand(paid) : '—'}</span>{tip > 0 && <span className="text-xs"> incl. tip</span>}</p>
        </div>
        {found !== undefined && paid > 0 && (
          <p className={`text-sm rounded-xl p-2.5 flex items-start gap-1.5 ${found ? 'bg-good/12' : 'bg-surface-2 text-muted'}`}>
            <Icon name={found ? 'check' : 'search'} size={16} className={`mt-0.5 shrink-0 ${found ? 'text-good' : ''}`} />
            {found
              ? <span>Payment found: <b>{found.description}</b> · {dayLabel(found.txn_date)} · {rand(found.amount)} ({found.account}){found.inferred_tip ? <> — card was charged {rand(found.inferred_tip)} more than the slip, which will be saved as the tip</> : null}</span>
              : <span>No payment of {rand(paid)} on record yet{tip === 0 ? ' — if you added a tip on the card machine, enter it above' : ''}.</span>}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <select className="input" value={d.payment_method} onChange={e => setD({ ...d, payment_method: e.target.value as SlipDraft['payment_method'] })}><option value="card">Paid by card</option><option value="cash">Paid cash</option><option value="unknown">Not sure</option></select>
          <CategorySelect categories={categories.filter(c => c.kind === 'expense')} value={cat} onChange={setCat} />
        </div>
        {d.items.length > 0 && (
          <div className="rounded-2xl bg-surface-2 p-3 text-sm max-h-40 overflow-y-auto">
            {d.items.map((i, k) => <div key={k} className="flex justify-between gap-3 py-0.5"><span className="truncate">{i.qty ? `${i.qty} × ` : ''}{i.name}</span><span className="num">{i.amount === null ? '' : rand(i.amount)}</span></div>)}
            {amount > 0 && Math.abs(itemsSum - amount) > 0.05 && <p className="text-xs text-muted border-t border-line mt-1 pt-1">Items add up to {rand(itemsSum)} — some lines may have been misread; the total above is what counts.</p>}
          </div>
        )}
        <button className="text-xs text-muted underline" onClick={() => setShowText(t => !t)}>{showText ? 'Hide' : 'Show'} raw text</button>
        {showText && <pre className="text-[11px] bg-surface-2 rounded-xl p-2 max-h-40 overflow-auto whitespace-pre-wrap">{draft.text}</pre>}
        <div className="flex gap-2"><button className="btn btn-ghost" onClick={onCancel}>Discard</button><button className="btn btn-coral flex-1" disabled={!(amount > 0) || !d.merchant.trim()} onClick={() => onSave({ ...d, total: amount, tip, category_id: cat })}>Save slip</button></div>
      </div>
    </div>
  )
}
