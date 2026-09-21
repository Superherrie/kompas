import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import Icon, { Logo } from './Icon'
import { useAuth } from '../context/AuthContext'

const NAV = [
  { to: '/', label: 'Today', icon: 'today', end: true },
  { to: '/overview', label: 'Overview', icon: 'chart' },
  { to: '/categories', label: 'Categories', icon: 'layers' },
  { to: '/transactions', label: 'Transactions', icon: 'list' },
  { to: '/slips', label: 'Slips', icon: 'receipt' },
  { to: '/import', label: 'Import', icon: 'upload' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
]
// phone tab bar: two either side of the camera button
const TABS = [NAV[0], NAV[2], null, NAV[3], NAV[1]]

export default function Layout() {
  const { member, signOut } = useAuth()
  const nav = useNavigate()
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

      <main className="flex-1 md:ml-60 pb-28 md:pb-10">
        <header className="md:hidden flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-2">
          <div className="flex items-center gap-2"><Logo size={28} /><span className="display text-xl">Kompas</span></div>
          <div className="flex items-center gap-1 text-muted">
            <NavLink to="/import" className="p-2"><Icon name="upload" /></NavLink>
            <NavLink to="/settings" className="p-2"><Icon name="settings" /></NavLink>
          </div>
        </header>
        <div className="mx-auto max-w-6xl px-4 md:px-8 md:pt-8"><Outlet /></div>
      </main>

      {/* phone tab bar */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-surface/95 backdrop-blur border-t border-line pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-5 items-end">
          {TABS.map((n, i) => n ? (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${isActive ? 'text-pine' : 'text-muted'}`}>
              <Icon name={n.icon} size={22} />{n.label}
            </NavLink>
          ) : (
            <button key={i} onClick={() => nav('/slips?scan=1')} aria-label="Scan a slip"
              className="mx-auto -mt-6 mb-2 grid place-items-center w-14 h-14 rounded-full bg-coral text-white shadow-lg shadow-coral/30 active:scale-95 transition">
              <Icon name="camera" size={26} />
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}
