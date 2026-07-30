import { useCallback, useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import api, { ApiError } from './api/client'
import type { User } from './api/types'
import Layout from './components/Layout'
import Login from './pages/Login'
import Overview from './pages/Overview'
import Portfolio from './pages/Portfolio'
import Opportunities from './pages/Opportunities'
import StrategyLab from './pages/StrategyLab'
import Execution from './pages/Execution'
import RiskCentre from './pages/RiskCentre'
import Journal from './pages/Journal'
import Settings from './pages/Settings'
import { Loading } from './components/primitives'

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [checked, setChecked] = useState(false)

  const check = useCallback(async () => {
    try {
      setUser(await api.me())
    } catch (err) {
      if (!(err instanceof ApiError) || err.isUnauthorized) setUser(null)
    } finally {
      setChecked(true)
    }
  }, [])

  useEffect(() => {
    check()
  }, [check])

  // Any 401 anywhere in the app drops back to the sign-in screen rather than
  // leaving stale account data on screen.
  useEffect(() => {
    const onUnauthorized = () => setUser(null)
    window.addEventListener('aegis:unauthorized', onUnauthorized)
    return () => window.removeEventListener('aegis:unauthorized', onUnauthorized)
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } finally {
      setUser(null)
    }
  }, [])

  if (!checked) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loading label="Starting AegisQuant" />
      </div>
    )
  }

  if (!user) return <Login onSignedIn={setUser} />

  return (
    <Layout user={user} onSignOut={logout}>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="/opportunities" element={<Opportunities />} />
        <Route path="/lab" element={<StrategyLab user={user} />} />
        <Route path="/execution" element={<Execution user={user} />} />
        <Route path="/risk" element={<RiskCentre />} />
        <Route path="/journal" element={<Journal user={user} />} />
        <Route path="/settings" element={<Settings user={user} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
