import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useFinance } from '../context/FinanceContext'
import { useLoad } from '../lib/data'
import { dayLabel, rand } from '../lib/format'
import { Card } from '../components/Charts'
import { Sheet } from '../components/Txns'
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

type Stage = { step: 'idle' } | { step: 'working'; label: string; preview: string } | { step: 'done'; slip: Slip; txnId: number | null; created: boolean; preview: string } | { step: 'error'; message: string }

export default function Slips() {
  const { session } = useAuth()
  const { reload: reloadFinance } = useFinance()
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
      setStage({ step: 'working', label: 'Uploading…', preview })
      const blob = await shrink(file)
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

  return (
    <div className="space-y-5">
      <h1 className="display text-3xl md:text-4xl">Slips</h1>
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => void onFile(e.target.files?.[0])} />

      <Card className="text-center">
        {stage.step === 'idle' && (
          <div className="py-6">
            <div className="mx-auto w-16 h-16 rounded-full bg-coral/15 text-coral grid place-items-center mb-3"><Icon name="camera" size={30} /></div>
            <p className="font-semibold">Snap the slip before it goes in the bin</p>
            <p className="text-sm text-muted max-w-sm mx-auto mt-1 mb-4">Kompas reads the shop, total and line items, then ties it to the card payment — so “Checkers R699” becomes what you actually bought.</p>
            <button className="btn btn-coral" onClick={() => input.current?.click()}><Icon name="camera" />Scan a slip</button>
          </div>
        )}
        {stage.step === 'working' && (
          <div className="py-4 flex flex-col items-center gap-3">
            <img src={stage.preview} alt="" className="h-40 rounded-xl object-cover opacity-70" />
            <p className="font-semibold animate-pulse">{stage.label}</p>
          </div>
        )}
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
                    {!stage.txnId && (stage.slip.payment_method === 'cash' ? 'Cash slip saved (the ATM withdrawal already counts as the spend).' : 'Saved — no matching payment yet.')}
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
        {slip.vat !== null && <div className="flex justify-between border-t border-line mt-1 pt-1 text-muted"><span>VAT</span><span className="num">{rand(+slip.vat)}</span></div>}
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
