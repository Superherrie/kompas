export type Kind = 'expense' | 'income' | 'transfer'

export interface Txn {
  id: number; txn_date: string; txn_time: string | null; month: string; description: string; amount: number
  source: 'statement' | 'email' | 'slip' | 'manual' | 'seed'; status: 'pending' | 'cleared'
  slip_id: number | null; note: string | null; balance_after: number | null; category_locked: boolean
  account_id: number; account: string
  sub_id: number | null; sub_name: string | null; cat_id: number | null; cat_name: string | null
  kind: Kind; discretionary: boolean; color: string | null
  /** month = accounting month (month-end FNB lines count in the next one); cal_month = the calendar month of txn_date */
  cal_month: string; period_locked: boolean
}
export interface Monthly {
  month: string; cat_id: number; cat_name: string; sub_id: number; sub_name: string
  kind: Kind; discretionary: boolean; color: string | null; account: string; total: number; n: number
}
export interface Category {
  id: number; parent_id: number | null; name: string; kind: Kind
  discretionary: boolean; color: string | null; budget: number | null; sort: number
}
export interface Account { id: number; name: string; bank: string | null; purpose: string | null; card_last4: string[]; color: string | null }
export interface SlipItem { name: string; qty?: number | null; amount: number | null }
export interface Slip {
  id: number; image_path: string | null; merchant: string | null; slip_date: string | null; slip_time: string | null
  total: number | null; tip: number | null; vat: number | null; payment_method: string | null; card_last4: string | null
  items: SlipItem[]; status: 'new' | 'matched' | 'unmatched' | 'failed'; note: string | null; created_at: string
  /** work pays this back: its payment sits outside household spend; claimed_on = handed in, repaid_on = money received */
  claimable: boolean; claimed_on: string | null; repaid_on: string | null
}
export interface Member { user_id: string; display_name: string; email: string | null; role: 'owner' | 'member' }
