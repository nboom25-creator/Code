import { useState } from 'react'
import api from '../api/client'
import type { User } from '../api/types'

export default function Login({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      const result = await api.login(email, password)
      onSignedIn(result.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">AegisQuant</h1>
          <p className="mt-1 text-sm text-ink-400">Autonomous research and execution platform</p>
        </div>

        <form onSubmit={submit} className="card space-y-4">
          <div>
            <label htmlFor="email" className="card-title">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded border border-ink-700 bg-ink-950 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="password" className="card-title">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded border border-ink-700 bg-ink-950 px-3 py-2 text-sm"
            />
          </div>

          {error && (
            <p role="alert" className="rounded border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-red-200">
              {error}
            </p>
          )}

          <button type="submit" className="btn-primary w-full justify-center" disabled={pending}>
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-ink-500">
          Sessions use an HttpOnly cookie. No broker credential or API key is ever sent to the browser.
        </p>
      </div>
    </main>
  )
}
