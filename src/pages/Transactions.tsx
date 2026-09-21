import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useFinance } from '../context/FinanceContext'
import { getTxns, useLoad } from '../lib/data'
import { rand0, today } from '../lib/format'
import { Card } from '../components/Charts'
import { CategorySelect, Sheet, TxnList } from '../components/Txns'
import { MonthNav, useMonthParam } from './Categories'
import Icon from '../components/Icon'
import type { Account } from '../lib/types'

type Filter = 'all' | 'disc' | 'pending' | 'uncat'

export default function Transactions() {
  const { categories, reload: reloadFinance } = useFinance()
  const [month, setMonth] = useMonthParam()
  const [search, setSearch] = useState(''); const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all'); const [account, setAccount] = useState('')
  const [adding, setAdding] = useState(false)
  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 300); return () => clearTimeout(t) }, [search])

  const uncat = categories.find(c => c.name === 'Uncategorised' && c.parent_id !== null)?.id
  // a search looks across all months; otherwise stay inside the chosen month
  const { data: txns, reload } = useLoad(() => getTxns({
    ...(q ? { search: q, limit: 300 } : { month }),
    ...(account ? { account } : {}), ...(filter === 'disc' ? { discretionary: true } : {}), ...(filter === 'pending' ? { status: 'pending' } : {}),
    ...(filter === 'uncat' && uncat ? { subId: uncat } : {}),
  }), [month, q, filter, account, uncat])
  const refresh = () => { void reload(); void reloadFinance() }
  const out = -(txns ?? []).filter(t => t.kind === 'expense').reduce((s, t) => s + t.amount, 0)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="display text-3xl md:text-4xl">Transactions</h1>
        <div className="flex items-center gap-2">{!q && <MonthNav month={month} onChange={setMonth} />}<button className="btn btn-primary" onClick={() => setAdding(true)}>+ Add</button></div>
      </div>
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-52"><Icon name="search" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input className="input !pl-10" placeholder="Search every month…" value={search} onChange={e => setSearch(e.target.value)} /></div>
        <select className="input !w-auto" value={account} onChange={e => setAccount(e.target.value)}><option value="">All accounts</option><option>FNB</option><option>Discovery</option></select>
      </div>
      <div className="flex gap-2 overflow-x-auto">
        {([['all', 'All'], ['disc', 'Discretionary'], ['pending', 'Pending'], ['uncat', 'Uncategorised']] as [Filter, string][]).map(([k, l]) =>
          <button key={k} onClick={() => setFilter(k)} className={`chip !text-sm !px-3 !py-1 whitespace-nowrap ${filter === k ? '!bg-pine !text-surface' : ''}`}>{l}</button>)}
      </div>
      <Card title={`${txns?.length ?? 0} transactions`} sub={`${rand0(out)} out`}>
        <TxnList txns={txns ?? []} categories={categories} onChanged={refresh} />
      </Card>
      {adding && <AddSheet onClose={() => setAdding(false)} onSaved={() => { setAdding(false); refresh() }} />}
    </div>
  )
}

/** cash or anything the bank feed won't show; stays 'pending' until a statement line clears it (or forever, for cash) */
function AddSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { categories } = useFinance()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [f, setF] = useState({ account_id: 0, txn_date: today(), description: '', amount: '', category_id: null as number | null, income: false })
  const [error, setError] = useState<string>()
  useEffect(() => { void supabase.from('pf_accounts').select('*').order('sort').then(({ data }) => { setAccounts((data ?? []) as Account[]); setF(x => ({ ...x, account_id: (data ?? []).find(a => a.name === 'Discovery')?.id ?? data?.[0]?.id ?? 0 })) }) }, [])
  async function save() {
    const amt = Math.abs(parseFloat(f.amount.replace(',', '.')))
    if (!f.description || !amt || !f.category_id) { setError('Description, amount and category are needed.'); return }
    const { error } = await supabase.from('pf_transactions').insert({ account_id: f.account_id, txn_date: f.txn_date, description: f.description, amount: f.income ? amt : -amt, category_id: f.category_id, category_locked: true, source: 'manual', status: 'pending' })
    if (error) setError(error.message); else onSaved()
  }
  return (
    <Sheet title="Add a transaction" onClose={onClose}>
      <div className="space-y-3">
        <input className="input" placeholder="Description" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <input className="input" inputMode="decimal" placeholder="Amount (R)" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} />
          <input className="input" type="date" value={f.txn_date} onChange={e => setF({ ...f, txn_date: e.target.value })} />
        </div>
        <select className="input" value={f.account_id} onChange={e => setF({ ...f, account_id: +e.target.value })}>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <CategorySelect categories={categories} value={f.category_id} onChange={id => setF({ ...f, category_id: id })} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.income} onChange={e => setF({ ...f, income: e.target.checked })} />Money in</label>
        {error && <p className="text-sm text-bad">{error}</p>}
        <button className="btn btn-primary w-full" onClick={() => void save()}>Save</button>
      </div>
    </Sheet>
  )
}
