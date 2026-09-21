// Matching what the company paid back to the payments flagged "claim back from work".
// One company payment usually settles several items (phone + subscriptions + …), so this is a subset-sum:
// for each payment, find the set of still-open claimable items, dated before it, that adds up to it.
// Rand items must add up exactly. Items billed in foreign currency (Xero, in USD) are claimed at the company's
// exchange rate rather than the bank's, so each of those may differ by up to FX_TOLERANCE of its value.

export interface ClaimItem { id: number; date: string; amount: number; description: string }     // amount = positive rand paid
export interface CompanyPayment { id: number; date: string; amount: number; description: string }
/** difference = paid back − what the items cost; sure = inside the tight FX band (tick off), otherwise a suggestion to confirm */
export interface ClaimMatch { payment: CompanyPayment; items: ClaimItem[]; difference: number; sure: boolean }
export interface MatchResult { matches: ClaimMatch[]; unmatchedPayments: (CompanyPayment & { closest?: { items: ClaimItem[]; difference: number } })[]; openItems: ClaimItem[] }

export const FX_SURE = 0.06         // the company's rate is usually 3–4% under the bank's (no card FX fee)
export const FX_TOLERANCE = 0.15    // beyond the sure band, up to this much is offered as a suggestion only
const WINDOW_DAYS = 120          // an item is claimed within a few months of being paid
const MAX_CANDIDATES = 18        // 2^18 subsets is still instant; older candidates beyond this are dropped first

export const isForeign = (description: string) => /\b(usd|eur|gbp|aud)\b|xero|\.com\b/i.test(description)
const days = (a: string, b: string) => (new Date(a).getTime() - new Date(b).getTime()) / 86400_000
const cents = (n: number) => Math.round(n * 100)

function best(payment: CompanyPayment, pool: ClaimItem[], strict: boolean, fx = FX_TOLERANCE) {
  const cand = pool.filter(i => i.date <= payment.date && days(payment.date, i.date) <= WINDOW_DAYS)
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, MAX_CANDIDATES)
  const target = cents(payment.amount); let win: { mask: number; diff: number; score: number } | undefined
  const age = cand.map(c => days(payment.date, c.date))
  for (let mask = 1; mask < 1 << cand.length; mask++) {
    let sum = 0, tol = 5, old = 0                                      // 5c of rounding
    for (let k = 0; k < cand.length; k++) if (mask & (1 << k)) { sum += cents(cand[k].amount); old += age[k]; if (isForeign(cand[k].description)) tol += cents(cand[k].amount) * fx }
    const diff = target - sum
    if (strict && Math.abs(diff) > tol) continue
    // Several sets can fit inside the FX tolerance. A claim is handed in soon after the money is spent, so the set
    // made of the most RECENT items is the believable one (not whichever happens to land nearest to the cent).
    // Without the tolerance (the "closest" hint for an unmatched payment) only the difference counts.
    const score = strict ? old + Math.abs(diff) / 10000 : Math.abs(diff)
    if (!win || score < win.score) win = { mask, diff, score }
  }
  return win && { items: cand.filter((_, k) => win!.mask & (1 << k)), difference: win.diff / 100 }
}

/** Two passes, payments oldest first, an item settled only once: first the matches inside the tight FX band
 *  (sure), then what is left is tried again with the wide band (suggestions). */
export function matchClaims(items: ClaimItem[], payments: CompanyPayment[]): MatchResult {
  let open = [...items]; const matches: ClaimMatch[] = []
  let left = [...payments].sort((a, b) => a.date.localeCompare(b.date))
  for (const [fx, sure] of [[FX_SURE, true], [FX_TOLERANCE, false]] as [number, boolean][]) {
    const still: CompanyPayment[] = []
    for (const p of left) {
      const hit = best(p, open, true, fx)
      if (hit) { matches.push({ payment: p, ...hit, sure }); const used = new Set(hit.items.map(i => i.id)); open = open.filter(i => !used.has(i.id)) }
      else still.push(p)
    }
    left = still
  }
  matches.sort((a, b) => a.payment.date.localeCompare(b.payment.date))
  return { matches, unmatchedPayments: left.map(p => ({ ...p, closest: best(p, open, false) })), openItems: open }
}
