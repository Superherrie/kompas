import { lazy, Suspense } from 'react'
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

// the statement parsers pull in pdf.js and SheetJS — only load them when someone imports
const Import = lazy(() => import('./pages/Import'))

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
          <Route path="categories" element={<Categories />} />
          <Route path="categories/:level/:id" element={<CategoryDetail />} />
          <Route path="transactions" element={<Transactions />} />
          <Route path="slips" element={<Slips />} />
          <Route path="import" element={<Suspense fallback={null}><Import /></Suspense>} />
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
