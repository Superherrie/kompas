// An iPhone home-screen app is resumed, not reloaded — it can keep running last week's build against this week's
// server functions. Whenever the app comes back to the foreground (and every 15 minutes while open) compare the
// script the page was loaded with against the one index.html points to now; if it changed, reload.
// Never in the middle of something: not while a sheet or a slip review is open, not while a field has focus.

const current = () => [...document.querySelectorAll<HTMLScriptElement>('script[type=module][src]')].map(s => new URL(s.src).pathname.split('/').pop()).find(n => n?.startsWith('index-'))

async function latest(): Promise<string | undefined> {
  const res = await fetch(`./index.html?ts=${Date.now()}`, { cache: 'no-store' })
  if (!res.ok) return undefined
  return (await res.text()).match(/assets\/(index-[\w-]+\.js)/)?.[1]
}

const busy = () => !!document.querySelector('[data-busy], .fixed.inset-0') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName ?? '')

export function watchForUpdates() {
  const mine = current()
  if (!mine) return                                   // dev server: nothing to compare
  let last = 0
  const check = async () => {
    if (document.visibilityState !== 'visible' || Date.now() - last < 60_000) return
    last = Date.now()
    try { const now = await latest(); if (now && now !== mine && !busy()) window.location.reload() } catch { /* offline — try again later */ }
  }
  document.addEventListener('visibilitychange', () => void check())
  window.addEventListener('pageshow', () => void check())
  window.addEventListener('focus', () => void check())
  setInterval(() => void check(), 15 * 60_000)
}
