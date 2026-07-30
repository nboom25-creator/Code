import { useCallback, useEffect, useRef, useState } from 'react'
import api, { ApiError } from '../api/client'

export interface FetchState<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
  lastUpdated: Date | null
}

/**
 * Polling fetch hook.
 *
 * Polls only while the tab is visible. A dashboard left open on a second monitor
 * should not keep hammering the API — and on a rate-limited endpoint that matters.
 */
export function useApi<T>(path: string | null, pollMs = 0): FetchState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(path !== null)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [nonce, setNonce] = useState(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!path) {
      setLoading(false)
      return
    }
    const controller = new AbortController()
    let timer: number | undefined

    const run = async () => {
      try {
        const payload = await api.get<T>(path, controller.signal)
        if (!mounted.current) return
        setData(payload)
        setError(null)
        setLastUpdated(new Date())
      } catch (err) {
        if (controller.signal.aborted || !mounted.current) return
        if (err instanceof ApiError && err.isUnauthorized) {
          // Let the auth boundary handle it rather than showing a scary error.
          window.dispatchEvent(new Event('aegis:unauthorized'))
          return
        }
        setError(err instanceof Error ? err.message : 'Request failed')
      } finally {
        if (mounted.current) setLoading(false)
      }
      if (pollMs > 0 && mounted.current) {
        timer = window.setTimeout(() => {
          if (document.visibilityState === 'visible') run()
          else timer = window.setTimeout(run, pollMs)
        }, pollMs)
      }
    }

    setLoading(true)
    run()
    return () => {
      controller.abort()
      if (timer) window.clearTimeout(timer)
    }
  }, [path, pollMs, nonce])

  return { data, loading, error, reload, lastUpdated }
}

/** Imperative mutation with pending/error state, for buttons. */
export function useMutation<TBody, TResult>(path: string) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<TResult | null>(null)

  const mutate = useCallback(
    async (body?: TBody): Promise<TResult | null> => {
      setPending(true)
      setError(null)
      try {
        const payload = await api.post<TResult>(path, body)
        setResult(payload)
        return payload
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Request failed')
        return null
      } finally {
        setPending(false)
      }
    },
    [path],
  )

  return { mutate, pending, error, result, reset: () => setError(null) }
}

/** Persist a small piece of UI state (never anything sensitive). */
export function useLocalState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(`aegis:${key}`)
      return raw ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })
  const update = useCallback(
    (next: T) => {
      setValue(next)
      try {
        window.localStorage.setItem(`aegis:${key}`, JSON.stringify(next))
      } catch {
        /* storage may be unavailable; UI preference is not critical */
      }
    },
    [key],
  )
  return [value, update]
}
