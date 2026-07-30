import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import type { Overview, User } from '../api/types'
import { useApi } from '../lib/hooks'
import { Badge } from './primitives'

const NAV = [
  { to: '/', label: 'Overview' },
  { to: '/portfolio', label: 'Portfolio' },
  { to: '/opportunities', label: 'Opportunities' },
  { to: '/lab', label: 'Strategy Lab' },
  { to: '/execution', label: 'Execution' },
  { to: '/risk', label: 'Risk Centre' },
  { to: '/journal', label: 'Journal' },
  { to: '/settings', label: 'Settings' },
]

export default function Layout({
  user,
  onSignOut,
  children,
}: {
  user: User
  onSignOut: () => void
  children: ReactNode
}) {
  // Poll the overview for the status strip so the mode, kill switch and health
  // state are visible on every screen, not just the dashboard.
  const { data } = useApi<Overview>('/overview', 20000)

  const mode = data?.mode ?? '…'
  const killSwitch = data?.controls.kill_switch_engaged
  const readOnly = data?.controls.read_only
  const riskState = data?.controls.risk_state
  const providersOk = data?.health.providers.all_ok
  const brokerOk = data?.health.broker.ok
  const dataIssues = data?.health.data_quality.blocking ?? 0
  const synthetic = data?.config.using_synthetic_data

  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-ink-800 focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      {/* Mode strip: LIVE gets an unmistakable treatment. */}
      <div
        className={`border-b px-4 py-1.5 text-xs ${
          mode === 'LIVE'
            ? 'border-danger bg-danger/25 text-red-100'
            : 'border-ink-800 bg-ink-900 text-ink-400'
        }`}
      >
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-1">
          <span className="font-semibold">
            {mode === 'LIVE' ? '● LIVE TRADING — REAL MONEY' : `Mode: ${mode}`}
          </span>
          {synthetic && <Badge tone="warn">simulated data</Badge>}
          {killSwitch && <Badge tone="danger">kill switch engaged</Badge>}
          {readOnly && <Badge tone="danger">read-only</Badge>}
          {riskState && riskState !== 'normal' && <Badge tone="bad">{riskState.replace('_', ' ')}</Badge>}
          <span className="ml-auto flex items-center gap-3">
            <span title="Market-data providers">
              data {providersOk === undefined ? '…' : providersOk ? '✓' : '✗'}
            </span>
            <span title="Broker connection">
              broker {brokerOk === undefined ? '…' : brokerOk ? '✓' : '✗'}
            </span>
            {dataIssues > 0 && <Badge tone="bad">{dataIssues} data issue(s)</Badge>}
          </span>
        </div>
      </div>

      <header className="border-b border-ink-800 bg-ink-900">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-4 px-4 py-3">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-semibold tracking-tight">AegisQuant</span>
            <span className="text-xs text-ink-500">v{data?.config.version ?? ''}</span>
          </div>

          <nav aria-label="Primary" className="flex flex-wrap gap-1">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `rounded px-2.5 py-1.5 text-sm transition-colors ${
                    isActive ? 'bg-ink-700 text-ink-50' : 'text-ink-300 hover:bg-ink-800 hover:text-ink-100'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3 text-xs text-ink-400">
            <span title={`Role: ${user.role}`}>
              {user.email} <Badge tone={user.role === 'admin' ? 'info' : 'neutral'}>{user.role}</Badge>
            </span>
            <button type="button" onClick={onSignOut} className="btn-default">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-[1600px] px-4 py-6">
        {children}
      </main>

      <footer className="mx-auto max-w-[1600px] px-4 pb-8 pt-2 text-xs text-ink-600">
        AegisQuant does not guarantee any level of performance. Backtested and simulated results are
        hypothetical. Live trading requires explicit human authorization.
      </footer>
    </div>
  )
}
