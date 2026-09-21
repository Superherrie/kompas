// Bank descriptions → a vendor name people recognise: "CheckersHyper Fourways SB007311 ZA", "Checkers Sixty60",
// "CHECKERS LIQUORSHOP…" are all Checkers; "TABBS*River Falls Spur Pretoria" is Spur; "Yoco *Brewtiful Bean Pre" is Brewtiful Bean.

// chains first: [needle in the normalised description, display name]. Order matters (liquor before the grocer it belongs to).
const CHAINS: [RegExp, string][] = [
  [/sixty60/, 'Checkers Sixty60'], [/liquorshop|checkersliq/, 'Checkers LiquorShop'], [/checkers|cxfresh|freshx|fresh x|^cx /, 'Checkers'],      // "CX Fresh X Jukskei Par SB…" = Checkers FreshX (same SB terminal codes) [/shoprite/, 'Shoprite'],
  [/pnpliq|picknpayliq/, 'Pick n Pay Liquor'], [/pnp|picknpay/, 'Pick n Pay'], [/tops(at)?spar|\btops\b/, 'Tops at Spar'], [/spar\b|superspar|kwikspar|spar/, 'Spar'],
  [/woolworths|woolies|\bww\b/, 'Woolworths'], [/foodlovers|flm\b/, 'Food Lover’s Market'], [/makro/, 'Makro'],
  [/liquorcity/, 'Liquor City'], [/ultraliq/, 'Ultra Liquors'], [/norman ?goodfellow/, 'Norman Goodfellows'],
  [/ubereats|uber \*?eats/, 'Uber Eats'], [/mrd(food)?\b|mrdelivery/, 'Mr D'], [/spur\b|spur|riverfallssp/, 'Spur'], [/4fifty1/, '4Fifty1'], [/foreverresort/, 'Forever Resorts Swadini'], [/muggnbean|^mandb/, 'Mugg & Bean'], [/kfc/, 'KFC'], [/mcd\b|mcdonald/, 'McDonald’s'],
  [/nandos/, 'Nando’s'], [/steers/, 'Steers'], [/wimpy/, 'Wimpy'], [/romans/, 'Roman’s Pizza'], [/debonairs/, 'Debonairs'], [/burgerking/, 'Burger King'],
  [/ocean ?basket/, 'Ocean Basket'], [/rocomamas/, 'RocoMamas'], [/mugg ?(&|and)? ?bean|muggbean/, 'Mugg & Bean'], [/tashas/, 'tashas'], [/doppio/, 'Doppio Zero'],
  [/seattle/, 'Seattle Coffee'], [/vida ?e/, 'Vida e Caffè'], [/starbucks/, 'Starbucks'], [/bootlegger/, 'Bootlegger'], [/flatwhite/, 'Flat White Coffee'],
  [/krispy/, 'Krispy Kreme'], [/kauai/, 'Kauai'], [/simply ?asia/, 'Simply Asia'], [/osaka/, 'Osaka Sushi'],
  [/astron/, 'Astron'], [/engen/, 'Engen'], [/\bshell\b/, 'Shell'], [/\bbp\b/, 'BP'], [/sasol/, 'Sasol'], [/totalenergies|\btotal\b/, 'TotalEnergies'],
  [/takealot/, 'Takealot'], [/clicks/, 'Clicks'], [/dis-?chem/, 'Dis-Chem'], [/netflix/, 'Netflix'], [/apple\.com|itunes/, 'Apple'], [/uber/, 'Uber'], [/bolt/, 'Bolt'],
]
// payment-facilitator prefixes that hide the real shop
const PREFIX = /^(yoco|ap|tabbs|tst|ik|snapscan|snap|zapper|payfast|pf|sq|sumup|izettle|peach|ozow|dl|paypal|pos|purchase|c)\s*\*\s*/i
const PLACES = /\b(za|zaf|rsa|gauteng|gau|jhb|johannesbur\w*|johannesburg|pretoria|pre|pta|sandton|randburg|rand|fourways|midrand|centurion|cape town|cpt|durban|dbn|bellville|krugersdorp|roodepoort|olivedale|broadacres|bryanston|garsfontein|jukskei\w*( par\w*)?)\b.*$/i

export function vendorOf(description: string): string {
  const flat = description.toLowerCase().replace(/[^a-z0-9*&. ]/g, ' '), squashed = flat.replace(/[^a-z0-9]/g, '')
  for (const [re, name] of CHAINS) if (re.test(flat) || re.test(squashed)) return name
  let s = description.replace(PREFIX, '').replace(/\s+\S*\d{4,}\S*.*$/, '')          // drop terminal / reference numbers and what follows
  s = s.replace(PLACES, '').replace(/[(*].*$/, '').replace(/\s+/g, ' ').trim()
  const words = s.split(' ').filter(Boolean).slice(0, 3).join(' ').replace(/[\s&-]+$/, '').replace(/\s+(and|the|of|on)$/i, '')
  const name = words || description.split(' ').slice(0, 2).join(' ')
  return name.toLowerCase().replace(/(^|[\s'’-])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase())
}

export interface VendorRow { vendor: string; total: number; n: number; last: string; months: number }
/** spend per vendor, largest first (amounts are negative for money out → totals come back positive) */
export function byVendor(txns: { description: string; amount: number; txn_date: string; month: string }[]): VendorRow[] {
  const m = new Map<string, VendorRow & { seen: Set<string> }>()
  for (const t of txns) {
    const k = vendorOf(t.description)
    const e = m.get(k) ?? { vendor: k, total: 0, n: 0, last: '', months: 0, seen: new Set<string>() }
    e.total -= t.amount; e.n++; if (t.txn_date > e.last) e.last = t.txn_date; e.seen.add(t.month)
    m.set(k, e)
  }
  return [...m.values()].map(({ seen, ...e }) => ({ ...e, months: seen.size })).sort((a, b) => b.total - a.total)
}
