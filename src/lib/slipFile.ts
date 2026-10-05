import { supabase } from './supabase'
import type { Slip } from './types'

/** "2026-09-28 Checkers R158.jpg" — sorts by date in a folder and says what it is when attached to a claim */
function fileName(slip: Slip) {
  const shop = (slip.merchant ?? 'Slip').replace(/[^\w &-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Slip'
  const total = slip.total === null ? '' : ` R${Math.round(+slip.total)}`
  const ext = slip.image_path?.match(/\.(\w{3,4})$/)?.[1] ?? 'jpg'
  return `${slip.slip_date ?? 'undated'} ${shop}${total}.${ext}`
}

/** Saves the slip's photo. A phone gets its share sheet (Save Image / Save to Files / Mail); a computer gets a normal download. */
export async function downloadSlip(slip: Slip) {
  if (!slip.image_path) throw new Error('This slip has no photo.')
  const { data: blob, error } = await supabase.storage.from('pf-slips').download(slip.image_path)
  if (error || !blob) throw new Error(error?.message ?? 'Could not fetch the photo.')
  const name = fileName(slip)
  const file = new File([blob], name, { type: blob.type || 'image/jpeg' })
  const phone = matchMedia('(pointer: coarse)').matches
  if (phone && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return } catch (e) { if ((e as Error).name === 'AbortError') return }   // closed the sheet
  }
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
