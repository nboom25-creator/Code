import type {
  AnalysisResponse,
  ApiError,
  BacktestRequest,
  BacktestResult,
  HealthInfo,
  Quote,
  SearchResult,
} from "./types";

export class StockCastError extends Error {
  code: string;
  setupHint?: string | null;
  status: number;
  constructor(code: string, message: string, status: number, setupHint?: string | null) {
    super(message);
    this.code = code;
    this.status = status;
    this.setupHint = setupHint;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    });
  } catch (e) {
    throw new StockCastError("network_error", "Cannot reach the StockCast API. Is the backend running on port 8000?", 0);
  }
  if (!res.ok) {
    let detail: ApiError | undefined;
    try {
      const body = await res.json();
      detail = body.detail ?? body;
    } catch {
      /* ignore */
    }
    throw new StockCastError(
      detail?.code || "error",
      detail?.error || `Request failed (${res.status})`,
      res.status,
      detail?.setup_hint,
    );
  }
  return res.json() as Promise<T>;
}

export interface Diagnostics {
  provider: string;
  symbol: string;
  reachable: boolean | null;
  configured: boolean;
  is_demo?: boolean;
  detail: string;
  live_price?: number;
  as_of?: string;
  source?: string;
  error_code?: string;
  likely_network_policy?: boolean;
  hint?: string | null;
  setup_hint?: string | null;
}

export const api = {
  health: () => request<HealthInfo>("/api/health"),
  diagnostics: () => request<Diagnostics>("/api/diagnostics"),
  search: (q: string) => request<SearchResult[]>(`/api/search?q=${encodeURIComponent(q)}`),
  quote: (ticker: string) => request<Quote>(`/api/quote/${encodeURIComponent(ticker)}`),
  random: () => request<{ ticker: string }>("/api/random"),
  analyze: (ticker: string) => request<AnalysisResponse>(`/api/analyze/${encodeURIComponent(ticker)}`),
  backtest: (body: BacktestRequest) =>
    request<BacktestResult>("/api/backtest", { method: "POST", body: JSON.stringify(body) }),
};
