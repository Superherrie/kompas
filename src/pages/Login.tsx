import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Logo } from '../components/Icon'

/** Layered hills + sun — the only illustration in the app, shared by the sign-in and "not on the list" screens. */
function Landscape() {
  return (
    <svg viewBox="0 0 800 600" preserveAspectRatio="xMidYMax slice" className="absolute inset-0 w-full h-full" aria-hidden>
      <rect width="800" height="600" fill="#12332e" />
      <circle cx="590" cy="210" r="86" fill="#e2b04a" opacity=".95" /><circle cx="590" cy="210" r="130" fill="#e2b04a" opacity=".12" />
      <path d="M0 380 Q140 300 300 360 T620 330 T800 370 V600 H0z" fill="#1f5f54" />
      <path d="M0 450 Q180 380 360 440 T800 420 V600 H0z" fill="#2c7a6b" />
      <path d="M0 520 Q220 460 440 510 T800 490 V600 H0z" fill="#e0694a" opacity=".92" />
      <path d="M0 565 Q260 525 520 560 T800 545 V600 H0z" fill="#f6f1e7" />
    </svg>
  )
}

export default function Login() {
  const { session, member, signOut } = useAuth()
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('')
  const [error, setError] = useState<string>(); const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(undefined)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) setError(error.message)
    setBusy(false)
  }

  return (
    <div className="min-h-full grid md:grid-cols-2">
      <div className="relative hidden md:block overflow-hidden">
        <Landscape />
        <div className="relative p-12 text-[#f6f1e7]">
          <p className="display text-5xl leading-tight max-w-md">Know where<br />the money went.</p>
          <p className="mt-4 max-w-sm text-white/70">Every swipe, slip and debit order in one place — so the month ends where you planned it to.</p>
        </div>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-3 mb-8"><Logo size={44} /><span className="display text-4xl">Kompas</span></div>
          {session && !member ? (
            <div className="card p-6">
              <p className="font-semibold mb-1">This login isn’t part of the household.</p>
              <p className="text-sm text-muted mb-4">You’re signed in as {session.user.email}, but Kompas is private. Ask the owner to add you under Settings → Household.</p>
              <button className="btn btn-ghost w-full" onClick={() => void signOut()}>Sign out</button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <input className="input" type="email" autoComplete="username" placeholder="E-mail" value={email} onChange={e => setEmail(e.target.value)} required />
              <input className="input" type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required />
              {error && <p className="text-sm text-bad">{error}</p>}
              <button className="btn btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
              <p className="text-xs text-muted text-center pt-2">Same login as your other apps.</p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
