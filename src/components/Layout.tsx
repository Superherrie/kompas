import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import Icon, { Logo } from './Icon'
import { useAuth } from '../context/AuthContext'

const NAV = [
  { to: '/', label: 'Today', icon: 'today', end: true },
  { to: '/overview', label: 'Overview', icon: 'chart' },
  { to: '/statement', label: 'Income Statement', icon: 'table' },
  { to: '/categories', label: 'Categories', icon: 'layers' },
  { to: '/transactions', label: 'Transactions', icon: 'list' },
  { to: '/slips', label: 'Slips', icon: 'receipt' },
  { to: '/claims', label: 'Claims Recon', icon: 'briefcase' },
  { to: '/import', label: 'Import', icon: 'upload' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
]
// phone tab bar: the three everyday screens, the camera in the middle, and "More" for everything else
const TABS = [NAV[0], NAV[3], null, NAV[4]]
const MORE = [NAV[1], NAV[2], NAV[5], NAV[6], NAV[7], NAV[8]]

export default function Layout() {
  const { member, signOut } = useAuth()
  const nav = useNavigate(); const loc = useLocation()
  const [more, setMore] = useState(false)
  useEffect(() => { window.scrollTo(0, 0) }, [loc.pathname])       // a new screen starts at the top
  const inMore = MORE.some(n => loc.pathname.startsWith(n.to))

  return (
    <div className="min-h-full md:flex">
      {/* desktop rail */}
      <aside className="hidden md:flex md:w-60 md:flex-col md:fixed md:inset-y-0 bg-pine-deep text-[#eef0e6] p-5">
        <div className="flex items-center gap-3 mb-8"><Logo size={36} /><span className="display text-2xl">Kompas</span></div>
        <nav className="flex-1 space-y-1">
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${isActive ? 'bg-white/12 text-white' : 'text-white/65 hover:text-white hover:bg-white/6'}`}>
              <Icon name={n.icon} />{n.label}
            </NavLink>
          ))}
        </nav>
        <button onClick={() => nav('/slips?scan=1')} className="btn btn-coral w-full mb-4"><Icon name="camera" />Scan a slip</button>
        <div className="flex items-center justify-between text-xs text-white/60">
          <span>{member?.display_name}</span>
          <button onClick={() => void signOut()} className="flex items-center gap-1 hover:text-white"><Icon name="out" size={14} />Sign out</button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 md:ml-60 pb-[calc(6.5rem+env(safe-area-inset-bottom))] md:pb-10">
        {/* phone: a slim brand bar that sits under the notch / Dynamic Island */}
        <header className="md:hidden sticky top-0 z-20 flex items-center gap-2 px-4 pt-[max(env(safe-area-inset-top),0.6rem)] pb-2 bg-bg/90 backdrop-blur">
          <Logo size={26} /><span className="display text-lg">Kompas</span>
        </header>
        <div className="mx-auto max-w-6xl px-4 md:px-8 md:pt-8"><Outlet /></div>
      </main>

      {/* phone tab bar */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-surface/95 backdrop-blur border-t border-line pb-[env(safe-area-inset-bottom)] select-none">
        <div className="grid grid-cols-5 items-end">
          {TABS.map((n, i) => n ? (
            <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setMore(false)}
              className={({ isActive }) => `flex flex-col items-center gap-0.5 pt-2.5 pb-2 text-[11px] font-medium ${isActive ? 'text-pine' : 'text-muted'}`}>
              <Icon name={n.icon} size={23} />{n.label}
            </NavLink>
          ) : (
            <button key={i} onClick={() => nav('/slips?scan=1')} aria-label="Scan a slip"
              className="mx-auto -mt-6 mb-1.5 grid place-items-center w-14 h-14 rounded-full bg-coral text-white shadow-lg shadow-coral/30 active:scale-95 transition">
              <Icon name="camera" size={26} />
            </button>
          ))}
          <button onClick={() => setMore(m => !m)} className={`flex flex-col items-center gap-0.5 pt-2.5 pb-2 text-[11px] font-medium ${more || inMore ? 'text-pine' : 'text-muted'}`}>
            <Icon name="more" size={23} />More
          </button>
        </div>
      </nav>

      {/* "More" sheet — every other screen, one thumb-reach away */}
      {more && (
        <div className="md:hidden fixed inset-0 z-20 bg-black/40" onClick={() => setMore(false)}>
          <div className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-surface p-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))]" onClick={e => e.stopPropagation()}>
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
            <div className="grid grid-cols-3 gap-2">
              {MORE.map(n => (
                <NavLink key={n.to} to={n.to} onClick={() => setMore(false)} className={({ isActive }) => `flex flex-col items-center gap-1.5 rounded-2xl py-4 text-xs font-medium ${isActive ? 'bg-pine/12 text-pine' : 'bg-surface-2 text-ink'}`}>
                  <Icon name={n.icon} size={24} />{n.label}
                </NavLink>
              ))}
              <button onClick={() => void signOut()} className="flex flex-col items-center gap-1.5 rounded-2xl py-4 text-xs font-medium bg-surface-2 text-muted"><Icon name="out" size={24} />Sign out</button>
            </div>
            <p className="text-center text-[11px] text-muted mt-3">{member?.display_name} · {member?.email}</p>
          </div>
        </div>
      )}
    </div>
  )
}
