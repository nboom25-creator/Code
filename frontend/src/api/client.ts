/**
 * API client.
 *
 * Security properties this preserves:
 * - The session lives in an HttpOnly cookie, so no token is ever stored in
 *   `localStorage` where a script could read it.
 * - Every mutating request echoes the CSRF cookie back in a header (double
 *   submit), which is what makes the cookie-based session safe.
 * - No credential of any kind — broker keys, API keys, passwords — is held in
 *   frontend state. The backend never sends them.
 */

const CSRF_COOKIE = 'aegis_csrf'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  get isUnauthorized(): boolean {
    return this.status === 401
  }

  get isForbidden(): boolean {
    return this.status === 403
  }
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = { accept: 'application/json' }

  if (options.body !== undefined) {
    headers['content-type'] = 'application/json'
  }
  if (method !== 'GET') {
    const csrf = readCookie(CSRF_COOKIE)
    if (csrf) headers['x-csrf-token'] = csrf
  }

  const response = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  })

  if (response.status === 204) return undefined as T

  const text = await response.text()
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
  }

  if (!response.ok) {
    const detail = (payload as { detail?: unknown } | null)?.detail
    const message =
      typeof detail === 'string'
        ? detail
        : typeof (detail as { message?: string })?.message === 'string'
          ? (detail as { message: string }).message
          : `Request failed (${response.status})`
    throw new ApiError(response.status, message, detail)
  }
  return payload as T
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),

  login: (email: string, password: string) =>
    request<{ user: import('./types').User; csrf_token: string }>('/auth/login', {
      method: 'POST',
      body: { email, password },
    }),
  logout: () => request<{ detail: string }>('/auth/logout', { method: 'POST' }),
  me: () => request<import('./types').User>('/auth/me'),
}

export default api
