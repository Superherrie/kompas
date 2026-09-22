import { Component, lazy, Suspense, type ReactNode } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { FinanceProvider } from './context/FinanceContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Today from './pages/Today'
import Overview from './pages/Overview'
import Categories, { CategoryDetail } from './pages/Categories'
import Transactions from './pages/Transactions'
import Slips from './pages/Slips'
import Settings from './pages/Settings'
import ClaimsRecon from './pages/ClaimsRecon'
import IncomeStatement from './pages/IncomeStatement'

// the statement parsers pull in pdf.js and SheetJS — only load them when someone imports
// Every deploy renames the chunks, so a tab left open from before a deploy asks for a file that no longer exists and the
// import rejects. Reload once to pick up the new build (the guard stops a reload loop if the failure is something else).
const Import = lazy(() => import('./pages/Import').then(m => { sessionStorage.removeItem('kompas-reloaded'); return m }, e => {
  if (!sessionStorage.getItem('kompas-reloaded')) { sessionStorage.setItem('kompas-reloaded', '1'); window.location.reload(); return new Promise<never>(() => {}) }
  throw e
}))

/** a crash on one screen must not blank the whole app */
class Boundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {}
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="card p-6 max-w-md mx-auto mt-10 text-center">
        <p className="display text-xl mb-1">That screen didn’t load</p>
        <p className="text-sm text-muted mb-4">{this.state.error.message}</p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload Kompas</button>
      </div>
    )
  }
}

function Shell() {
  const { session, member, loading } = useAuth()
  if (loading) return <div className="h-full grid place-items-center text-muted">Loading…</div>
  if (!session || !member) return <Login />
  return (
    <FinanceProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Today />} />
          <Route path="overview" element={<Overview />} />
          <Route path="statement" element={<IncomeStatement />} />
          <Route path="categories" element={<Categories />} />
          <Route path="categories/:level/:id" element={<CategoryDetail />} />
          <Route path="transactions" element={<Transactions />} />
          <Route path="slips" element={<Slips />} />
          <Route path="claims" element={<ClaimsRecon />} />
          <Route path="import" element={<Boundary><Suspense fallback={<p className="text-muted py-10 text-center animate-pulse">Loading the import tools…</p>}><Import /></Suspense></Boundary>} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </FinanceProvider>
  )
}

export default function App() {
  return <AuthProvider><HashRouter><Shell /></HashRouter></AuthProvider>
}
