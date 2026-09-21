import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useFinance } from '../context/FinanceContext'
import { useLoad } from '../lib/data'
import { parseDiscoveryXlsx, parseFnbPdf, type Parsed } from '../lib/statements'
import { rand0 } from '../lib/format'
import { Card } from '../components/Charts'
import Icon from '../components/Icon'

interface Result { file: string; parsed?: Parsed; outcome?: { inserted: number; cleared: number; skipped: number }; error?: string }

export default function Import() {
  const { categories, reload: reloadFinance } = useFinance()
  const [results, setResults] = useState<Result[]>([]); const [busy, setBusy] = useState(false)
  const { data: log, reload } = useLoad(async () => (await supabase.from('pf_sync_log').select('*').order('created_at', { ascending: false }).limit(12)).data ?? [], [])

  // Discovery's export carries its own category — use it when no learned rule knows the description
  const hint = (cat: string, sub: string, amount: number) => {
    if (cat === 'Not for Financial Analyser') return categories.find(c => c.name === 'Savings pockets')?.id
    const parent = categories.find(c => c.parent_id === null && c.name === cat)
    const hit = categories.find(c => c.parent_id === parent?.id && c.name === sub)
    return hit && hit.name !== 'Uncategorised' && (amount < 0) === (hit.kind === 'expense') ? hit.id : undefined
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return
    setBusy(true); const out: Result[] = []
    for (const file of [...files]) {
      try {
        const parsed = /\.pdf$/i.test(file.name) ? await parseFnbPdf(file) : await parseDiscoveryXlsx(file, hint)
        if (!parsed.rows.length) throw new Error('No transactions found in this file.')
        const { data, error } = await supabase.rpc('pf_import_txns', { p_account: parsed.account, p_source: 'statement', p_rows: parsed.rows })
        if (error) throw new Error(error.message)
        out.push({ file: file.name, parsed, outcome: data })
      } catch (e) { out.push({ file: file.name, error: String((e as Error).message ?? e) }) }
      setResults([...out])
    }
    setBusy(false); void reload(); void reloadFinance()
  }

  return (
    <div className="space-y-5">
      <h1 className="display text-3xl md:text-4xl">Import statements</h1>
      <Card>
        <label className={`block rounded-2xl border-2 border-dashed border-line p-8 text-center cursor-pointer hover:border-pine transition ${busy ? 'opacity-60 pointer-events-none' : ''}`}
          onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void onFiles(e.dataTransfer.files) }}>
          <Icon name="upload" size={30} className="mx-auto text-pine mb-2" />
          <p className="font-semibold">{busy ? 'Reading…' : 'Drop statements here, or tap to choose'}</p>
          <p className="text-sm text-muted mt-1">FNB statement <b>PDF</b> · Discovery Bank Smart Search <b>Excel</b>. Several at once is fine.</p>
          <input type="file" multiple accept=".pdf,.xlsx,.xls" className="hidden" onChange={e => void onFiles(e.target.files)} />
        </label>
        <p className="text-xs text-muted mt-3">Safe to re-import: lines already loaded are skipped, and pending lines from bank e-mails or slips are confirmed rather than duplicated. Files are read in your browser — only the transactions are stored.</p>
      </Card>

      {results.map(r => (
        <Card key={r.file} title={r.file} sub={r.parsed ? `${r.parsed.account} · ${r.parsed.period ?? ''}` : undefined}>
          {r.error ? <p className="text-bad text-sm">{r.error}</p> : r.outcome && (
            <div className="grid grid-cols-3 gap-3 text-center">
              <Stat n={r.outcome.inserted} label="new" /><Stat n={r.outcome.cleared} label="pending confirmed" /><Stat n={r.outcome.skipped} label="already loaded" />
              <p className="col-span-3 text-xs text-muted">{r.parsed!.rows.length} lines read · {rand0(-r.parsed!.rows.filter(x => x.amount < 0).reduce((s, x) => s + x.amount, 0))} out · {rand0(r.parsed!.rows.filter(x => x.amount > 0).reduce((s, x) => s + x.amount, 0))} in</p>
            </div>
          )}
        </Card>
      ))}

      <Card title="Sync history" sub="Bank e-mails, slips and statement imports">
        <div className="divide-y divide-line text-sm">
          {(log as { id: number; source: string; received: number; inserted: number; note: string; created_at: string }[]).map(l => (
            <div key={l.id} className="flex justify-between gap-3 py-2"><span><span className="font-medium">{l.source}</span> <span className="text-muted">· {l.inserted} new of {l.received} · {l.note}</span></span><span className="text-muted whitespace-nowrap">{new Date(l.created_at).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>
          ))}
          {!log?.length && <p className="text-muted py-2">Nothing synced yet.</p>}
        </div>
      </Card>
    </div>
  )
}

const Stat = ({ n, label }: { n: number; label: string }) => <div className="rounded-2xl bg-surface-2 py-3"><p className="display text-2xl num">{n}</p><p className="text-xs text-muted">{label}</p></div>
