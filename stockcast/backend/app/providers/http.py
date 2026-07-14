"""Shared async HTTP client with timeouts, retries and backoff.

Used by the network-backed providers. Retries are limited to transient
conditions (network errors, 5xx, 429) with exponential backoff.
"""
from __future__ import annotations

import asyncio

import httpx

from app.config import get_settings
from app.providers.base import ProviderError, RateLimited


async def get_json(url: str, params: dict | None = None, headers: dict | None = None) -> dict:
    return await _request("GET", url, params=params, headers=headers, want="json")


async def get_text(url: str, params: dict | None = None, headers: dict | None = None) -> str:
    return await _request("GET", url, params=params, headers=headers, want="text")


async def _request(method: str, url: str, *, params=None, headers=None, want="json"):
    settings = get_settings()
    last_exc: Exception | None = None
    for attempt in range(settings.http_max_retries):
        try:
            async with httpx.AsyncClient(timeout=settings.http_timeout_seconds) as client:
                resp = await client.request(method, url, params=params, headers=headers)
            if resp.status_code == 429:
                raise RateLimited()
            if resp.status_code >= 500:
                raise ProviderError(f"Upstream {resp.status_code}", code="upstream_error")
            resp.raise_for_status()
            return resp.json() if want == "json" else resp.text
        except (RateLimited, ProviderError) as exc:
            last_exc = exc
            # Backoff on transient upstream/ratelimit; give up on the last try.
            if attempt < settings.http_max_retries - 1:
                await asyncio.sleep(2**attempt)
                continue
            raise
        except httpx.HTTPStatusError as exc:
            # 4xx (except 429) are not retryable.
            raise ProviderError(
                f"HTTP {exc.response.status_code} from provider", code="upstream_error"
            ) from exc
        except httpx.HTTPError as exc:
            last_exc = exc
            if attempt < settings.http_max_retries - 1:
                await asyncio.sleep(2**attempt)
                continue
            raise ProviderError(f"Network error contacting provider: {exc}", code="network_error") from exc
    raise ProviderError(f"Request failed: {last_exc}", code="network_error")
