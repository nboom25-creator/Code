import { useState } from 'react'
import type { LivePreflight, PromotionStatus, SettingsResponse, User } from '../api/types'
import {
  Badge,
  Card,
  ErrorBox,
  KeyValue,
  Loading,
  Table,
} from '../components/primitives'
import { useApi, useMutation } from '../lib/hooks'
import { MISSING, dateTime, money, titleCase } from '../lib/format'

export default function Settings({ user }: { user: User }) {
  const settings = useApi<SettingsResponse>('/settings', 60000)
  const preflight = useApi<LivePreflight>('/live/preflight', 60000)
  const promotion = useApi<PromotionStatus>('/promotion', 120000)

  if (settings.loading && !settings.data) return <Loading label="Loading configuration" />
  if (settings.error && !settings.data) return <ErrorBox error={settings.error} onRetry={settings.reload} />
  if (!settings.data) return null

  const data = settings.data
  const isAdmin = user.role === 'admin'

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Platform">
          <dl>
            <KeyValue label="Mode" value={<Badge tone={data.config.mode === 'LIVE' ? 'danger' : 'info'}>{data.config.mode}</Badge>} />
            <KeyValue label="Version" value={data.config.version} />
            <KeyValue label="Environment" value={data.config.env_name} />
            <KeyValue label="Timezone (display)" value={data.config.timezone} />
            <KeyValue label="Base currency" value={data.config.base_currency} />
            <KeyValue label="Benchmark" value={data.config.benchmark_symbol ?? 'SPY'} />
            <KeyValue
              label="LLM narration"
              value={data.config.llm_enabled ? <Badge tone="warn">enabled</Badge> : <Badge tone="good">deterministic</Badge>}
            />
          </dl>
        </Card>

        <Card title="Data providers" hint="Credentials stay server-side and are never returned by the API">
          <dl>
            <KeyValue label="Prices" value={data.config.price_provider} />
            <KeyValue label="Fundamentals" value={data.config.fundamentals_provider} />
            <KeyValue label="News" value={data.config.news_provider} />
            <KeyValue label="Macro" value={data.config.macro_provider} />
            <KeyValue label="Calendar" value={data.config.calendar_provider} />
            <KeyValue
              label="Provider health"
              value={data.providers.all_ok ? <Badge tone="good">operational</Badge> : <Badge tone="bad">degraded</Badge>}
            />
          </dl>
          <h4 className="card-title mt-3">Credentials configured</h4>
          <dl className="mt-1">
            {Object.entries(data.credentials_configured).map(([name, configured]) => (
              <KeyValue
                key={name}
                label={titleCase(name)}
                value={configured ? <Badge tone="good">set</Badge> : <Badge tone="neutral">not set</Badge>}
              />
            ))}
          </dl>
          {data.config.using_synthetic_data && (
            <p className="mt-3 rounded border border-warn/40 bg-warn/10 px-2 py-1.5 text-xs text-warn">
              The price provider is the built-in simulator. All market data and performance figures are
              simulated.
            </p>
          )}
        </Card>

        <Card title="Trading schedule and broker">
          <dl>
            <KeyValue label="Broker" value={data.config.broker} />
            <KeyValue
              label="Autonomous loop"
              value={data.config.loop_enabled ? <Badge tone="good">enabled</Badge> : <Badge tone="neutral">disabled</Badge>}
            />
            <KeyValue label="Cycle interval" value={`${data.config.loop_interval_seconds}s`} />
            <KeyValue label="Regular hours only" value="yes" />
            <KeyValue label="Last cycle" value={dateTime(String(data.system_state.last_loop_at ?? '')) } />
            <KeyValue label="Last reconciliation" value={dateTime(String(data.system_state.last_reconcile_at ?? ''))} />
          </dl>
          <RunLoopButton canAct={user.role !== 'readonly' && user.role !== 'viewer'} />
        </Card>
      </div>

      <Card
        title="Risk configuration"
        hint={`Version ${data.risk_config.version} · source: ${data.risk_config.source}${
          data.risk_config.updated_by ? ` · last changed by ${data.risk_config.updated_by}` : ''
        }`}
      >
        {data.risk_config.note && <p className="mb-3 text-xs text-ink-400">{data.risk_config.note}</p>}
        <div className="grid gap-x-6 md:grid-cols-3">
          {Object.entries(data.risk_config.limits).map(([name, value]) => (
            <KeyValue key={name} label={titleCase(name)} value={value} />
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-500">
          Limits are edited by an administrator through <code>POST /api/settings/risk</code>. Submitted
          values are validated before they are stored, so an unsafe combination — a Kelly fraction above
          0.5, or out-of-order drawdown stages — is rejected rather than saved.
        </p>
      </Card>

      <Card
        title="Paper-to-live promotion gate"
        hint="Configurable governance thresholds — not evidence of future profitability"
      >
        {!promotion.data ? (
          <Loading />
        ) : (
          <>
            <Table
              head={
                <tr>
                  <th>Strategy</th>
                  <th>Current</th>
                  <th>Next</th>
                  <th>Gate</th>
                  <th>Blocking requirements</th>
                </tr>
              }
            >
              {promotion.data.strategies.map((row) => (
                <tr key={row.strategy_key}>
                  <td className="font-medium">{titleCase(row.strategy_key)}</td>
                  <td>
                    <Badge tone="neutral">{row.from_status.replace(/_/g, ' ')}</Badge>
                  </td>
                  <td className="text-xs text-ink-400">{row.to_status?.replace(/_/g, ' ') ?? MISSING}</td>
                  <td>
                    {row.passed ? <Badge tone="good">eligible</Badge> : <Badge tone="bad">blocked</Badge>}
                  </td>
                  <td className="max-w-lg text-xs text-ink-300">
                    {row.blocking.length ? (
                      <ul className="space-y-0.5">
                        {row.blocking.slice(0, 4).map((reason) => (
                          <li key={reason}>• {reason}</li>
                        ))}
                        {row.blocking.length > 4 && (
                          <li className="text-ink-500">…and {row.blocking.length - 4} more</li>
                        )}
                      </ul>
                    ) : (
                      <span className="text-gain">all requirements met</span>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
            <div className="mt-3 grid gap-x-6 md:grid-cols-3">
              {Object.entries(promotion.data.thresholds).map(([name, value]) => (
                <KeyValue key={name} label={titleCase(name)} value={value} />
              ))}
            </div>
          </>
        )}
      </Card>

      <LiveControls
        data={data}
        preflight={preflight.data}
        isAdmin={isAdmin}
        onChanged={() => {
          settings.reload()
          preflight.reload()
        }}
      />

      <Card title="Intentionally deferred features" hint="Interfaces exist; the capability is disabled in version 1">
        <ul className="space-y-1 text-sm text-ink-300">
          {data.deferred_features.map((feature) => (
            <li key={feature}>• {feature}</li>
          ))}
        </ul>
      </Card>
    </div>
  )
}

function RunLoopButton({ canAct }: { canAct: boolean }) {
  const { mutate, pending, error, result } = useMutation<undefined, { status: string }>('/loop/run')
  return (
    <div className="mt-3">
      <button type="button" className="btn-default" disabled={!canAct || pending} onClick={() => mutate()}>
        {pending ? 'Queueing…' : 'Run one cycle now'}
      </button>
      {result && <p className="mt-1 text-xs text-gain">Cycle queued. See the Journal for the result.</p>}
      {error && <p className="mt-1 text-xs text-loss">{error}</p>}
    </div>
  )
}

function LiveControls({
  data,
  preflight,
  isAdmin,
  onChanged,
}: {
  data: SettingsResponse
  preflight: LivePreflight | null
  isAdmin: boolean
  onChanged: () => void
}) {
  const [phrase, setPhrase] = useState('')
  const [acknowledged, setAcknowledged] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [reason, setReason] = useState('')
  const enable = useMutation<
    { confirmation_phrase: string; ui_confirmed: boolean; acknowledged_account_identifier: string | null },
    unknown
  >('/live/enable')
  const disable = useMutation<{ reason: string }, unknown>('/live/disable')

  const authorized = data.live_controls.authorized

  return (
    <Card
      title="Live trading"
      hint="Disabled by default. Enabling it requires every condition below to hold simultaneously."
      className={data.config.mode === 'LIVE' ? 'border-danger/60' : undefined}
    >
      <div className="rounded border border-danger/40 bg-danger/10 px-3 py-2">
        <p className="text-sm font-semibold text-red-200">
          {authorized ? '● Live trading is AUTHORIZED — real money is at risk' : 'Live trading is not authorized'}
        </p>
        <p className="mt-1 text-xs text-ink-300">{data.live_controls.authorization_reason}</p>
        {preflight?.warning && <p className="mt-1 text-xs text-ink-400">{preflight.warning}</p>}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <h4 className="card-title">Preflight checks</h4>
          {!preflight ? (
            <Loading />
          ) : (
            <ul className="mt-2 space-y-1 text-xs">
              {preflight.checks.map((check) => (
                <li key={check.name} className="flex gap-2">
                  <span className={check.passed ? 'text-gain' : 'text-loss'} aria-hidden>
                    {check.passed ? '✓' : '✗'}
                  </span>
                  <span className="w-44 shrink-0 text-ink-400">{titleCase(check.name)}</span>
                  <span className={check.passed ? 'text-ink-300' : 'text-red-200'}>{check.message}</span>
                </li>
              ))}
            </ul>
          )}
          {preflight?.required_steps && (
            <>
              <h4 className="card-title mt-4">Required steps</h4>
              <ol className="mt-1 list-inside list-decimal space-y-0.5 text-xs text-ink-400">
                {preflight.required_steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </>
          )}
        </div>

        <div>
          <h4 className="card-title">Authorization</h4>
          <dl className="mt-2">
            <KeyValue label="Mode" value={data.live_controls.mode} />
            <KeyValue
              label="Environment flag"
              value={
                data.live_controls.env_flag_enabled ? (
                  <Badge tone="warn">enabled</Badge>
                ) : (
                  <Badge tone="good">disabled</Badge>
                )
              }
            />
            <KeyValue label="Account" value={preflight?.account_identifier ?? MISSING} />
            <KeyValue label="Broker" value={preflight?.broker ?? data.config.broker} />
            <KeyValue label="Maximum allocation" value={money(data.live_controls.max_allocation_usd)} />
            <KeyValue
              label="Promotion gate required"
              value={data.live_controls.requires_promotion_gate ? 'yes' : 'no'}
            />
          </dl>

          {!isAdmin ? (
            <p className="mt-3 rounded border border-ink-700 bg-ink-850 px-3 py-2 text-xs text-ink-400">
              Only an administrator can change live-trading authorization.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              <label className="block">
                <span className="card-title">Confirmation phrase</span>
                <input
                  type="text"
                  value={phrase}
                  onChange={(e) => setPhrase(e.target.value)}
                  placeholder="Re-type the configured phrase exactly"
                  className="mt-1 w-full rounded border border-ink-700 bg-ink-950 px-3 py-2 text-sm"
                  autoComplete="off"
                />
              </label>
              <label className="block">
                <span className="card-title">Acknowledge the account identifier shown above</span>
                <input
                  type="text"
                  value={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.value)}
                  placeholder={preflight?.account_identifier ?? 'account identifier'}
                  className="mt-1 w-full rounded border border-ink-700 bg-ink-950 px-3 py-2 text-sm"
                  autoComplete="off"
                />
              </label>
              <label className="flex items-start gap-2 text-xs text-ink-300">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-0.5"
                />
                I confirm I am authorizing this system to place orders with real money on the account
                shown above, bounded by the maximum allocation.
              </label>
              <button
                type="button"
                className="btn-danger w-full justify-center"
                disabled={enable.pending || !confirmed || phrase.length < 3}
                onClick={async () => {
                  await enable.mutate({
                    confirmation_phrase: phrase,
                    ui_confirmed: confirmed,
                    acknowledged_account_identifier: acknowledged || null,
                  })
                  setPhrase('')
                  onChanged()
                }}
              >
                {enable.pending ? 'Requesting…' : 'Enable live trading'}
              </button>
              {enable.error && <p className="text-xs text-loss">{enable.error}</p>}

              <div className="mt-4 border-t border-ink-800 pt-3">
                <label className="block">
                  <span className="card-title">Reason for disabling</span>
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="mt-1 w-full rounded border border-ink-700 bg-ink-950 px-3 py-2 text-sm"
                  />
                </label>
                <button
                  type="button"
                  className="btn-default mt-2 w-full justify-center"
                  disabled={disable.pending || reason.trim().length < 3}
                  onClick={async () => {
                    await disable.mutate({ reason })
                    onChanged()
                  }}
                >
                  Disable live trading
                </button>
                <p className="mt-1 text-[11px] text-ink-500">
                  Disabling is never gated — reducing risk is always permitted.
                </p>
                {disable.error && <p className="mt-1 text-xs text-loss">{disable.error}</p>}
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
