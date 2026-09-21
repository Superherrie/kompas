import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Member } from '../lib/types'

interface AuthState { session: Session | null; member: Member | null; loading: boolean; signOut: () => Promise<void> }
const AuthContext = createContext<AuthState>({ session: null, member: null, loading: true, signOut: async () => {} })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [member, setMember] = useState<Member | null>(null)
  const [loading, setLoading] = useState(true)

  async function load(s: Session | null) {
    if (!s) { setMember(null); return }
    // the project also holds work logins — only people on the household list get in
    const { data } = await supabase.from('pf_members').select('*').eq('user_id', s.user.id).maybeSingle()
    setMember((data as Member) ?? null)
  }
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => { setSession(data.session); await load(data.session); setLoading(false) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); void load(s) })
    return () => sub.subscription.unsubscribe()
  }, [])

  return (
    <AuthContext.Provider value={{ session, member, loading, signOut: async () => { await supabase.auth.signOut() } }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() { return useContext(AuthContext) }
