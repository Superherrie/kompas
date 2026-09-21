import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { getCategories, getMonthly, getSetting, useLoad } from '../lib/data'
import { supabase } from '../lib/supabase'
import type { Category, Monthly } from '../lib/types'

interface Finance {
  monthly: Monthly[]; categories: Category[]; budget: number; months: string[]
  /** a category's budget for a month: that month's row, else the latest earlier one (budgets carry forward) */
  budgetFor: (catId: number, month: string) => number | undefined
  loading: boolean; error?: string; reload: () => Promise<void>
}
const Ctx = createContext<Finance>({ monthly: [], categories: [], budget: 0, months: [], budgetFor: () => undefined, loading: true, reload: async () => {} })

/** Monthly totals, the category tree and the discretionary budget — loaded once, shared by every page. */
export function FinanceProvider({ children }: { children: ReactNode }) {
  const { data, loading, error, reload } = useLoad(async () => {
    const [monthly, categories, budget, b] = await Promise.all([getMonthly(), getCategories(), getSetting('discretionary_budget'), supabase.from('pf_budgets').select('category_id,month,amount').order('month')])
    return { monthly, categories, budget: +(budget ?? 0), budgets: (b.data ?? []) as { category_id: number; month: string; amount: number }[] }
  }, [])
  const months = useMemo(() => [...new Set((data?.monthly ?? []).map(m => m.month))].sort(), [data])
  const budgetFor = useCallback((catId: number, month: string) => {
    const rows = (data?.budgets ?? []).filter(r => r.category_id === catId && r.month <= month)
    return rows.length ? +rows[rows.length - 1].amount : undefined
  }, [data])
  return (
    <Ctx.Provider value={{ budgetFor, monthly: data?.monthly ?? [], categories: data?.categories ?? [], budget: data?.budget ?? 0, months, loading, error, reload }}>
      {children}
    </Ctx.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useFinance = () => useContext(Ctx)

/** expenses are stored negative; dashboards talk about "spend" as a positive number */
// eslint-disable-next-line react-refresh/only-export-components
export const spend = (rows: Monthly[]) => -rows.filter(r => r.kind === 'expense').reduce((s, r) => s + r.total, 0)
