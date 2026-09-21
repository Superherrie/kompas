import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import type { Category, Monthly, Txn } from './types'

/** PostgREST caps a response at 1000 rows — page until it runs dry. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchAll<T>(build: () => any): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data as T[]))
    if (!data || data.length < 1000) return out
  }
}

export const getMonthly = () =>
  fetchAll<Monthly>(() => supabase.from('pf_v_monthly').select('*').order('month').order('sub_id').order('account'))
    .then(rows => rows.map(r => ({ ...r, total: +r.total })))

export interface TxnFilter { /** accounting month(s) */ month?: string; months?: string[]; from?: string; to?: string; catId?: number; subId?: number; account?: string; search?: string; discretionary?: boolean; status?: string; claimable?: boolean; limit?: number }
export async function getTxns(f: TxnFilter): Promise<Txn[]> {
  const build = () => {
    let q = supabase.from('pf_v_txns').select('*')
    if (f.month) q = q.eq('month', f.month)
    if (f.months) q = q.in('month', f.months)
    if (f.from) q = q.gte('txn_date', f.from)
    if (f.to) q = q.lte('txn_date', f.to)
    if (f.catId) q = q.eq('cat_id', f.catId)
    if (f.subId) q = q.eq('sub_id', f.subId)
    if (f.account) q = q.eq('account', f.account)
    if (f.status) q = q.eq('status', f.status)
    if (f.claimable !== undefined) q = q.eq('claimable', f.claimable)
    if (f.discretionary !== undefined) q = q.eq('discretionary', f.discretionary).eq('kind', 'expense')
    if (f.search) q = q.ilike('description', `%${f.search.replace(/[%,]/g, ' ')}%`)
    return q.order('txn_date', { ascending: false }).order('txn_time', { ascending: false, nullsFirst: false }).order('id', { ascending: false })
  }
  const num = (rows: Txn[]) => rows.map(t => ({ ...t, amount: +t.amount }))
  if (f.limit) {
    const { data, error } = await build().limit(f.limit)
    if (error) throw new Error(error.message)
    return num(data as Txn[])
  }
  return num(await fetchAll<Txn>(build))
}

export const getCategories = async () => {
  const { data, error } = await supabase.from('pf_categories').select('*').order('sort').order('name')
  if (error) throw new Error(error.message)
  return (data as Category[]).map(c => ({ ...c, budget: c.budget === null ? null : +c.budget }))
}

export async function getSetting(key: string) {
  const { data } = await supabase.from('pf_settings').select('value').eq('key', key).maybeSingle()
  return data?.value as string | undefined
}
export const setSetting = (key: string, value: string) => supabase.from('pf_settings').upsert({ key, value })

/** tiny async-state hook: data, error, loading and a reload() */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T>(); const [error, setError] = useState<string>(); const [loading, setLoading] = useState(true)
  const latest = useRef(fn)
  useEffect(() => { latest.current = fn })
  const key = JSON.stringify(deps)
  const reload = useCallback(() => {
    setLoading(true)
    return latest.current().then(d => { setData(d); setError(undefined) }).catch(e => setError(String(e.message ?? e))).finally(() => setLoading(false))
  }, [])
  useEffect(() => { void reload() }, [reload, key])
  return { data, error, loading, reload }
}
