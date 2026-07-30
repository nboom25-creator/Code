import { Fragment, useState } from 'react'
import type { Order, User } from '../api/types'
import {
  Badge,
  Card,
  Empty,
  ErrorBox,
  KeyValue,
  Loading,
  StatusBadge,
  Table,
} from '../components/primitives'
import { useApi, useMutation } from '../lib/hooks'
import { MISSING, bps, dateTime, money, quantity, relativeTime, titleCase } from '../lib/format'

interface OrdersResponse {
  mode: string
  orders: Order[]
  status_counts: Record<string, number>
}

interface FillsResponse {
  fills: Array<{
    at: string
    order_id: number
    symbol: string
    side: string
    quantity: string
    price: string
    commission: string
    is_partial: boolean
    slippage_bps: string | null
  }>
  fill_quality: {
    count: number
    mean_slippage_bps: number | null
    worst_slippage_bps: number | null
    best_slippage_bps: number | null
  }
}

interface ReconRun {
  id: number
  at: string
  status: string
  positions_checked: number
  orders_checked: number
  breaks: { items?: Array<Record<string, unknown>>; count?: number } | null
  auto_healed: { count?: number } | null
  resolved: boolean
  duration_ms: number | null
  error: string | null
}

export default function Execution({ user }: { user: User }) {
  const orders = useApi<OrdersResponse>('/orders?limit=150', 15000)
  const fills = useApi<FillsResponse>('/fills?limit=100', 30000)
  const recon = useApi<ReconRun[]>('/reconciliation?limit=10', 30000)
  const [openOrder, setOpenOrder] = useState<number | null>(null)

  const canAct = user.role === 'admin' || user.role === 'operator'

  return (
    <div className="space-y-6">
      <EmergencyControls user={user} onAction={() => { orders.reload(); recon.reload() }} />

      <div className="grid gap-4 lg:grid-cols-4">
        <Card title="Fill quality" hint="Realised slippage against the decision reference price">
          <dl>
            <KeyValue label="Fills sampled" value={fills.data?.fill_quality.count ?? MISSING} />
            <KeyValue label="Mean slippage" value={bps(fills.data?.fill_quality.mean_slippage_bps)} />
            <KeyValue label="Worst slippage" value={bps(fills.data?.fill_quality.worst_slippage_bps)} />
            <KeyValue label="Best slippage" value={bps(fills.data?.fill_quality.best_slippage_bps)} />
          </dl>
        </Card>

        <Card title="Order status" className="lg:col-span-1">
          {!orders.data ? (
            <Loading />
          ) : (
            <dl>
              {Object.entries(orders.data.status_counts).map(([status, count]) => (
                <KeyValue key={status} label={titleCase(status)} value={count} />
              ))}
              {!Object.keys(orders.data.status_counts).length && (
                <p className="text-xs text-ink-500">No orders recorded.</p>
              )}
            </dl>
          )}
        </Card>

        <Card
          title="Broker reconciliation"
          className="lg:col-span-2"
          hint="Local state versus the broker's own record"
          actions={<ReconcileButton canAct={canAct} onDone={recon.reload} />}
        >
          {!recon.data?.length ? (
            <Empty message="No reconciliation runs yet" />
          ) : (
            <ul className="space-y-2">
              {recon.data.slice(0, 4).map((run) => (
                <li key={run.id} className="rounded border border-ink-800 px-3 py-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={run.status} />
                    {!run.resolved && <Badge tone="bad">unresolved</Badge>}
                    <span className="text-ink-400">{relativeTime(run.at)}</span>
                    <span className="ml-auto text-ink-500">
                      {run.positions_checked} positions · {run.orders_checked} orders
                    </span>
                  </div>
                  {run.breaks?.count ? (
                    <p className="mt-1 text-warn">
                      {run.breaks.count} break(s), {run.auto_healed?.count ?? 0} healed automatically
                    </p>
                  ) : (
                    <p className="mt-1 text-ink-500">Local and broker state agree.</p>
                  )}
                  {run.error && <p className="mt-1 text-loss">{run.error}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card
        title="Orders"
        actions={
          <button type="button" className="btn-default" onClick={orders.reload}>
            Refresh
          </button>
        }
      >
        {orders.loading && !orders.data ? (
          <Loading />
        ) : orders.error ? (
          <ErrorBox error={orders.error} onRetry={orders.reload} />
        ) : !orders.data?.orders.length ? (
          <Empty
            message="No orders yet"
            hint="Orders appear once the autonomous loop finds a candidate that clears every risk check."
          />
        ) : (
          <Table
            head={
              <tr>
                <th>Symbol</th>
                <th>Side</th>
                <th>Type</th>
                <th>Status</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Filled</th>
                <th className="text-right">Limit</th>
                <th className="text-right">Avg fill</th>
                <th className="text-right">Est. cost</th>
                <th className="text-right">Slippage</th>
                <th>Strategy</th>
                <th>Submitted</th>
                <th />
              </tr>
            }
          >
            {orders.data.orders.map((order) => (
              <Fragment key={order.id}>
                <tr>
                  <td className="font-medium">{order.symbol}</td>
                  <td>
                    <Badge tone={order.side === 'buy' ? 'good' : 'bad'}>{order.side}</Badge>
                  </td>
                  <td className="text-xs">{order.order_type.replace('_', ' ')}</td>
                  <td>
                    <StatusBadge status={order.status} />
                    {order.reject_reason && (
                      <div className="mt-0.5 max-w-[220px] text-[11px] text-loss">{order.reject_reason}</div>
                    )}
                  </td>
                  <td className="num text-right">{quantity(order.quantity)}</td>
                  <td className="num text-right">{quantity(order.filled_quantity)}</td>
                  <td className="num text-right">{money(order.limit_price)}</td>
                  <td className="num text-right">{money(order.avg_fill_price)}</td>
                  <td className="num text-right text-ink-400">{bps(order.expected_total_cost_bps)}</td>
                  <td className="num text-right">{bps(order.realized_slippage_bps)}</td>
                  <td className="text-xs text-ink-400">{titleCase(order.strategy_key)}</td>
                  <td className="text-xs text-ink-400">{relativeTime(order.submitted_at)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn-default text-xs"
                      onClick={() => setOpenOrder(openOrder === order.id ? null : order.id)}
                    >
                      {openOrder === order.id ? 'Hide' : 'Events'}
                    </button>
                  </td>
                </tr>
                {openOrder === order.id && (
                  <tr>
                    <td colSpan={13} className="bg-ink-950/60">
                      <OrderEvents orderId={order.id} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Recent fills">
        {!fills.data?.fills.length ? (
          <Empty message="No fills recorded" />
        ) : (
          <Table
            head={
              <tr>
                <th>Time</th>
                <th>Symbol</th>
                <th>Side</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Price</th>
                <th className="text-right">Commission</th>
                <th className="text-right">Slippage</th>
                <th>Partial</th>
              </tr>
            }
          >
            {fills.data.fills.map((fill, index) => (
              <tr key={`${fill.order_id}-${fill.at}-${index}`}>
                <td className="text-xs">{dateTime(fill.at)}</td>
                <td className="font-medium">{fill.symbol}</td>
                <td>
                  <Badge tone={fill.side === 'buy' ? 'good' : 'bad'}>{fill.side}</Badge>
                </td>
                <td className="num text-right">{quantity(fill.quantity)}</td>
                <td className="num text-right">{money(fill.price)}</td>
                <td className="num text-right text-ink-400">{money(fill.commission)}</td>
                <td className="num text-right">{bps(fill.slippage_bps)}</td>
                <td>{fill.is_partial ? <Badge tone="warn">partial</Badge> : null}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  )
}

function OrderEvents({ orderId }: { orderId: number }) {
  const { data, loading } = useApi<Order>(`/orders/${orderId}`, 0)
  if (loading) return <Loading label="Loading order events" />
  if (!data) return null
  return (
    <div className="grid gap-4 p-2 md:grid-cols-2">
      <div>
        <h4 className="card-title">Lifecycle</h4>
        <ol className="mt-2 space-y-1 text-xs">
          {(data.events ?? []).map((event, index) => (
            <li key={index} className="flex flex-wrap gap-2">
              <span className="text-ink-500">{dateTime(event.at)}</span>
              <span className="font-medium">{titleCase(event.event_type)}</span>
              {event.from_status && event.to_status && (
                <span className="text-ink-400">
                  {event.from_status} → {event.to_status}
                </span>
              )}
              <Badge tone="neutral">{event.source}</Badge>
              {event.message && <span className="text-ink-400">{event.message}</span>}
            </li>
          ))}
        </ol>
      </div>
      <div>
        <h4 className="card-title">Identity and costs</h4>
        <dl className="mt-2">
          <KeyValue label="Client order id" value={<span className="text-[11px]">{data.client_order_id}</span>} />
          <KeyValue label="Broker order id" value={data.broker_order_id ?? MISSING} />
          <KeyValue label="Reference price" value={money(data.reference_price)} />
          <KeyValue label="Expected total cost" value={bps(data.expected_total_cost_bps)} />
          <KeyValue label="Realised slippage" value={bps(data.realized_slippage_bps)} />
          <KeyValue label="Commission" value={money(data.commission)} />
          <KeyValue label="Submit attempts" value={data.submit_attempts ?? MISSING} />
          <KeyValue label="Decision" value={data.decision_id ? `#${data.decision_id}` : MISSING} />
        </dl>
        <p className="mt-2 text-[11px] text-ink-600">
          The client order id is derived deterministically from the decision, so a retry after a crash
          cannot create a second order.
        </p>
      </div>
    </div>
  )
}

function ReconcileButton({ canAct, onDone }: { canAct: boolean; onDone: () => void }) {
  const { mutate, pending } = useMutation<undefined, unknown>('/reconciliation/run')
  return (
    <button
      type="button"
      className="btn-default"
      disabled={!canAct || pending}
      onClick={async () => {
        await mutate()
        onDone()
      }}
    >
      {pending ? 'Reconciling…' : 'Reconcile now'}
    </button>
  )
}

function EmergencyControls({ user, onAction }: { user: User; onAction: () => void }) {
  const [reason, setReason] = useState('')
  const [confirmFlatten, setConfirmFlatten] = useState(false)
  const kill = useMutation<{ engage: boolean; reason: string }, { kill_switch_engaged: boolean }>(
    '/controls/kill-switch',
  )
  const readOnly = useMutation<{ engage: boolean; reason: string }, { read_only: boolean }>(
    '/controls/read-only',
  )
  const cancelAll = useMutation<{ engage: boolean; reason: string }, { cancelled: number }>(
    '/controls/cancel-all',
  )
  const flatten = useMutation<{ reason: string; confirm: boolean }, Record<string, unknown>>(
    '/controls/flatten',
  )
  const recover = useMutation<{ engage: boolean; reason: string }, Record<string, unknown>>(
    '/controls/recover',
  )

  const canAct = user.role === 'admin' || user.role === 'operator'
  const isAdmin = user.role === 'admin'
  const reasonOk = reason.trim().length >= 3
  const errors = [kill.error, readOnly.error, cancelAll.error, flatten.error, recover.error].filter(Boolean)

  const run = async (fn: () => Promise<unknown>) => {
    await fn()
    onAction()
  }

  return (
    <Card
      title="Emergency controls"
      hint="Every action here is audited with your identity and the reason you give"
    >
      {!canAct && (
        <p className="mb-3 rounded border border-ink-700 bg-ink-850 px-3 py-2 text-xs text-ink-400">
          Your role cannot use emergency controls.
        </p>
      )}

      <label className="block">
        <span className="card-title">Reason (required, recorded in the audit log)</span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. investigating unexpected fill prices"
          className="mt-1 w-full rounded border border-ink-700 bg-ink-950 px-3 py-2 text-sm"
        />
      </label>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-danger"
          disabled={!canAct || !reasonOk || kill.pending}
          onClick={() => run(() => kill.mutate({ engage: true, reason }))}
        >
          Engage kill switch
        </button>
        <button
          type="button"
          className="btn-default"
          disabled={!canAct || !reasonOk || kill.pending}
          onClick={() => run(() => kill.mutate({ engage: false, reason }))}
        >
          Release kill switch
        </button>
        <button
          type="button"
          className="btn-default"
          disabled={!canAct || !reasonOk || readOnly.pending}
          onClick={() => run(() => readOnly.mutate({ engage: true, reason }))}
        >
          Enter read-only mode
        </button>
        <button
          type="button"
          className="btn-default"
          disabled={!canAct || !reasonOk || readOnly.pending}
          onClick={() => run(() => readOnly.mutate({ engage: false, reason }))}
        >
          Leave read-only mode
        </button>
        <button
          type="button"
          className="btn-default"
          disabled={!canAct || !reasonOk || cancelAll.pending}
          onClick={() => run(() => cancelAll.mutate({ engage: true, reason }))}
        >
          Cancel all orders
        </button>
        <button
          type="button"
          className="btn-default"
          disabled={!isAdmin || !reasonOk || recover.pending}
          onClick={() => run(() => recover.mutate({ engage: false, reason }))}
          title="Clears a trading halt and cooldown after a loss limit. Administrator only."
        >
          Approve recovery
        </button>
      </div>

      <div className="mt-4 rounded border border-danger/50 bg-danger/10 p-3">
        <p className="text-xs font-semibold text-red-200">
          Flatten positions — sells every open position at market
        </p>
        <p className="mt-1 text-xs text-ink-300">
          Uses market orders on purpose: when flattening, certainty of execution matters more than
          price. Administrator only, and it cannot be undone.
        </p>
        <label className="mt-2 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={confirmFlatten}
            onChange={(e) => setConfirmFlatten(e.target.checked)}
          />
          I understand this liquidates the entire portfolio
        </label>
        <button
          type="button"
          className="btn-danger mt-2"
          disabled={!isAdmin || !reasonOk || !confirmFlatten || flatten.pending}
          onClick={() => run(() => flatten.mutate({ reason, confirm: true }))}
        >
          {flatten.pending ? 'Flattening…' : 'Flatten all positions'}
        </button>
      </div>

      {errors.length > 0 && (
        <div className="mt-3 space-y-1">
          {errors.map((message) => (
            <p key={message} className="text-xs text-loss">
              {message}
            </p>
          ))}
        </div>
      )}
    </Card>
  )
}
