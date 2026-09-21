import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { getCategories, getMonthly, getSetting, useLoad } from '../lib/data'
import type { Category, Monthly } from '../lib/types'

interface Finance {
  monthly: Monthly[]; categories: Category[]; budget: number; months: string[]
  loading: boolean; error?: string; reload: () => Promise<void>
}
const Ctx = createContext<Finance>({ monthly: [], categories: [], budget: 0, months: [], loading: true, reload: async () => {} })

/** Monthly totals, the category tree and the discretionary budget — loaded once, shared by every page. */
export function FinanceProvider({ children }: { children: ReactNode }) {
  const { data, loading, error, reload } = useLoad(async () => {
    const [monthly, categories, budget] = await Promise.all([getMonthly(), getCategories(), getSetting('discretionary_budget')])
    return { monthly, categories, budget: +(budget ?? 0) }
  }, [])
  const months = useMemo(() => [...new Set((data?.monthly ?? []).map(m => m.month))].sort(), [data])
  return (
    <Ctx.Provider value={{ monthly: data?.monthly ?? [], categories: data?.categories ?? [], budget: data?.budget ?? 0, months, loading, error, reload }}>
      {children}
    </Ctx.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useFinance = () => useContext(Ctx)

/** expenses are stored negative; dashboards talk about "spend" as a positive number */
// eslint-disable-next-line react-refresh/only-export-components
export const spend = (rows: Monthly[]) => -rows.filter(r => r.kind === 'expense').reduce((s, r) => s + r.total, 0)
