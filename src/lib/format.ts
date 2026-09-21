const zar0 = new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 0 })
const spaced = (s: string) => s.replace(new RegExp('[,\u00a0\u202f]', 'g'), ' ')

/** R 1 235 — whole rands everywhere (Herman: no cents); always positive, the sign is the caller's business */
export const rand0 = (n: number) => `R ${spaced(zar0.format(Math.abs(Math.round(n))))}`
export const rand = rand0
/** R12k for chart axes */
export const randK = (n: number) => Math.abs(n) >= 1000 ? `R${(n / 1000).toFixed(Math.abs(n) >= 10000 ? 0 : 1)}k` : `R${Math.round(n)}`

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** '2026-09' → 'Sep 2026' */
export const monthLabel = (m: string, short = false) => `${MONTHS[+m.slice(5, 7) - 1]} ${short ? `’${m.slice(2, 4)}` : m.slice(0, 4)}`
export const thisMonth = () => new Date().toLocaleDateString('sv').slice(0, 7)
export const today = () => new Date().toLocaleDateString('sv')
export const daysInMonth = (m: string) => new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate()
export const addMonths = (m: string, n: number) => {
  const d = new Date(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
/** '2026-09-20' → 'Sun 20 Sep' */
export const dayLabel = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })
