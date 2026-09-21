// Free, on-device slip reading: Tesseract (WASM) in the browser + heuristics for South African till slips.
// Nothing leaves the phone except the language model download from the Tesseract CDN on first use.
// OCR on thermal paper is imperfect by nature, so the result always goes through a review step before it is saved.
import type { SlipItem } from './types'

export interface SlipDraft {
  merchant: string; date: string | null; time: string | null; total: number | null; vat: number | null
  payment_method: 'card' | 'cash' | 'unknown'; card_last4: string | null; items: SlipItem[]; text: string
}

const MONEY = /(?:R\s?)?(-?\d{1,3}(?:[ ,]\d{3})*[.,]\d{2})(?!\d)/g
const num = (s: string) => parseFloat(s.replace(/[ ,](?=\d{3})/g, '').replace(',', '.'))
const monies = (line: string) => [...line.matchAll(MONEY)].map(m => num(m[1])).filter(n => !Number.isNaN(n))
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const iso = (y: number, m: number, d: number) => (m >= 1 && m <= 12 && d >= 1 && d <= 31) ? `${y < 100 ? 2000 + y : y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null

function findDate(text: string): string | null {
  let m = text.match(/\b(20\d{2})[/.-](\d{1,2})[/.-](\d{1,2})\b/); if (m) return iso(+m[1], +m[2], +m[3])
  m = text.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2}|\d{2})\b/); if (m) return iso(+m[3], +m[2], +m[1])      // SA slips are day-first
  m = text.match(/\b(\d{1,2})\s*([A-Za-z]{3})[a-z]*\.?,?\s*(20\d{2}|\d{2})\b/); if (m && MON.includes(m[2].toLowerCase())) return iso(+m[3], MON.indexOf(m[2].toLowerCase()) + 1, +m[1])
  return null
}

const NOT_TOTAL = /sub\s*-?\s*total|vat|tax|saving|discount|tender|change|round|points|balance b|loyalty|tip\b/i
const NOT_ITEM = /total|vat|tax|tender|change|cash|card|visa|master|debit|credit|round|balance|saving|discount|invoice|tel|auth|approved|\bpin\b|batch|terminal|merchant/i

export function parseSlipText(text: string): SlipDraft {
  const lines = text.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean)

  // shop name: first line near the top that reads like words rather than an address, number or header
  const merchant = lines.slice(0, 8).find(l => (l.match(/[A-Za-z]/g)?.length ?? 0) >= 4 && !/tax invoice|invoice|vat ?(no|reg)|reg\.? ?no|tel|www\.|\.co\.za|welcome|customer copy|\d{4,}/i.test(l)) ?? lines[0] ?? ''

  // total: the last "TOTAL / AMOUNT DUE" style line; then a card-payment line; then the largest amount on the slip
  let total: number | null = null, totalAt = lines.length
  for (let i = lines.length - 1; i >= 0 && total === null; i--) {
    if (/\b(total|amount due|amt due|balance due|due|to pay|bill total)\b/i.test(lines[i]) && !NOT_TOTAL.test(lines[i])) {
      const v = monies(lines[i]).concat(monies(lines[i + 1] ?? ''))          // amount sometimes wraps to the next line
      if (v.length) { total = Math.abs(v[0]); totalAt = i }
    }
  }
  if (total === null) for (const l of lines) if (/\b(card|visa|master|debit|credit|purchase|amount)\b/i.test(l) && !NOT_TOTAL.test(l)) { const v = monies(l); if (v.length) { total = Math.abs(v[v.length - 1]); break } }
  if (total === null) { const all = lines.filter(l => !/tender|change/i.test(l)).flatMap(monies).map(Math.abs); if (all.length) total = Math.max(...all) }

  const vatLine = lines.find(l => /\b(vat|tax)\b/i.test(l) && !/vat ?(no|reg|#)|tax invoice|incl/i.test(l) && monies(l).length)
  const vat = vatLine ? Math.abs(monies(vatLine).slice(-1)[0]) : null

  const cardLast4 = text.match(/(?:\*|x|X|#|\.){4,}\s?(\d{4})\b/)?.[1] ?? null
  const paidCash = /\bcash\b/i.test(text) && /tender|change/i.test(text) && !cardLast4 && !/\b(visa|master ?card|debit card|credit card|contactless|tap)\b/i.test(text)
  const paidCard = !!cardLast4 || /\b(visa|master ?card|debit card|credit card|contactless|approved|auth(orisation)? ?(code|no))\b/i.test(text)

  const items: SlipItem[] = []
  for (const l of lines.slice(1, totalAt)) {
    const m = l.match(/^(.*[A-Za-z]{2}.*?)\s+R?\s?(-?\d{1,4}[.,]\d{2})\s?[A-Z*#]?$/)
    if (!m || NOT_ITEM.test(m[1])) continue
    const q = m[1].match(/^(\d{1,2})\s?[xX@]\s+(.*)$/)
    items.push({ name: (q ? q[2] : m[1]).trim(), qty: q ? +q[1] : null, amount: num(m[2]) })
  }

  // Personal use: every line is shown VAT-inclusive. Most tills print inclusive prices already; when a slip lists
  // exclusive lines (items + VAT = total, e.g. wholesalers and some restaurants) gross the lines up so they add to what was paid.
  const sum = items.reduce((s, i) => s + (i.amount ?? 0), 0)
  if (total !== null && vat !== null && vat > 0 && sum > 0 && Math.abs(sum + vat - total) <= 0.06 && Math.abs(sum - total) > 0.06) {
    const k = total / sum
    for (const i of items) if (i.amount !== null) i.amount = Math.round(i.amount * k * 100) / 100
    const drift = Math.round((total - items.reduce((s, i) => s + (i.amount ?? 0), 0)) * 100) / 100      // rounding → largest line
    const big = items.filter(i => i.amount !== null).sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))[0]
    if (big && drift) big.amount = Math.round(((big.amount ?? 0) + drift) * 100) / 100
  }

  return {
    merchant: merchant.replace(/[^\w &'().*/-]/g, '').trim(), date: findDate(text), time: text.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\b/)?.slice(1, 3).join(':').padStart(5, '0') ?? null,
    total, vat, payment_method: paidCash ? 'cash' : paidCard ? 'card' : 'unknown', card_last4: cardLast4, items, text,
  }
}

/** greyscale + contrast stretch + upscale: thermal slips are low-contrast and OCR wants ~30px-tall glyphs */
async function prepare(file: Blob): Promise<HTMLCanvasElement> {
  const img = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const k = Math.min(2400 / Math.max(img.width, img.height), 2)
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, c.width, c.height)
  const d = ctx.getImageData(0, 0, c.width, c.height), p = d.data, hist = new Uint32Array(256)
  for (let i = 0; i < p.length; i += 4) { const g = (p[i] * 77 + p[i + 1] * 150 + p[i + 2] * 29) >> 8; p[i] = g; hist[g]++ }
  const n = p.length / 4; let lo = 0, hi = 255, acc = 0
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * 0.02) { lo = v; break } }
  acc = 0; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * 0.30) { hi = v; break } }      // paper is most of the photo → push it to white
  const span = Math.max(1, hi - lo)
  for (let i = 0; i < p.length; i += 4) { const g = Math.max(0, Math.min(255, ((p[i] - lo) * 255) / span)); p[i] = p[i + 1] = p[i + 2] = g }
  ctx.putImageData(d, 0, 0)
  return c
}

export async function readSlip(file: Blob, onProgress?: (pct: number) => void): Promise<SlipDraft> {
  const { createWorker, PSM } = await import('tesseract.js')                       // ~lazy: only when someone scans
  const worker = await createWorker('eng', 1, { logger: m => { if (m.status === 'recognizing text') onProgress?.(Math.round(m.progress * 100)) } })
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: '1' })
    const { data } = await worker.recognize(await prepare(file))
    return parseSlipText(data.text)
  } finally { await worker.terminate() }
}
