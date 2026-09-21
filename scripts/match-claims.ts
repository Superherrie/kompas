// Matches company payments (expense-claim refunds) to the transactions flagged "claim back from work".
//   node --experimental-strip-types scripts/match-claims.ts            # dry run: prints what it would tick off
//   node --experimental-strip-types scripts/match-claims.ts --apply    # marks the items repaid and the payment as a reimbursement
// Same matcher as the app's "Match company payments" button (src/lib/claimMatch.ts).
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { matchClaims, isForeign, type ClaimItem, type CompanyPayment } from '../src/lib/claimMatch.ts'

const env = Object.fromEntries(readFileSync(new URL('./.env', import.meta.url), 'utf8').split(/\r?\n/).map(l => l.match(/^([A-Z_]+)\s*=\s*(.+)$/)).filter(Boolean).map(m => [m![1], m![2].trim()]))
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const apply = process.argv.includes('--apply')

const { data: payers } = await sb.from('pf_settings').select('value').eq('key', 'claim_payers').maybeSingle()
const names = (payers?.value ?? 'interconnect systems,asi connect').split(',').map((s: string) => s.trim()).filter(Boolean)

const { data: flagged, error: e1 } = await sb.from('pf_v_txns').select('id,txn_date,description,amount').eq('claimable', true).is('repaid_on', null).order('txn_date')
if (e1) throw new Error(e1.message)
const { data: credits, error: e2 } = await sb.from('pf_v_txns').select('id,txn_date,description,amount,sub_name').gt('amount', 0)
  .or(names.map((n: string) => `description.ilike.%${n}%`).join(',')).neq('sub_name', 'Reimbursed by work').order('txn_date')
if (e2) throw new Error(e2.message)

const items: ClaimItem[] = flagged!.map(t => ({ id: t.id, date: t.txn_date, amount: -t.amount, description: t.description }))
const payments: CompanyPayment[] = credits!.map(t => ({ id: t.id, date: t.txn_date, amount: +t.amount, description: t.description }))
const r = matchClaims(items, payments)

const R = (n: number) => n.toFixed(2).padStart(10)
for (const m of r.matches) {
  console.log(`\n✔ ${m.payment.date} ${R(m.payment.amount)}  ${m.payment.description}   (difference ${m.difference >= 0 ? '+' : ''}${m.difference.toFixed(2)})`)
  for (const i of m.items) console.log(`     ${i.date} ${R(i.amount)}  ${i.description.slice(0, 48)}${isForeign(i.description) ? '   [FX]' : ''}`)
}
console.log('\n— company payments with no matching set of flagged items —')
for (const p of r.unmatchedPayments) console.log(`✘ ${p.date} ${R(p.amount)}  ${p.description}${p.closest ? `   closest: ${p.closest.items.length} items, ${p.closest.difference >= 0 ? 'R' + p.closest.difference.toFixed(2) + ' more paid than flagged' : 'R' + (-p.closest.difference).toFixed(2) + ' short'}` : ''}`)
console.log(`\n${r.matches.length} payments matched (${r.matches.reduce((s, m) => s + m.items.length, 0)} items, R${r.matches.reduce((s, m) => s + m.payment.amount, 0).toFixed(2)}); ${r.unmatchedPayments.length} payments unmatched; ${r.openItems.length} flagged items still open (R${r.openItems.reduce((s, i) => s + i.amount, 0).toFixed(2)})`)

if (apply) {
  for (const m of r.matches.filter(x => x.sure || process.argv.includes('--include-suggestions'))) {
    const { error } = await sb.rpc('pf_settle_claims', { p_payment: m.payment.id, p_items: m.items.map(i => i.id) })
    if (error) throw new Error(error.message)
  }
  console.log('applied.')
} else console.log('(dry run — add --apply)')
