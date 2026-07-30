"""Authentication, authorisation and request hardening.

Design choices and why:

**Session cookie, not a bearer token in JavaScript.** The JWT lives in an
``HttpOnly``, ``SameSite=Lax`` cookie so a cross-site script cannot read it. That
reintroduces CSRF risk, so a double-submit CSRF token is required on every
state-changing request.

**bcrypt, with SHA-256 pre-hashing.** bcrypt silently truncates input at 72
bytes, which turns a long passphrase into a weaker secret than the user believes.
Passwords are therefore SHA-256'd and base64-encoded before hashing, so the full
input always contributes entropy. Password hashes are never returned by any
endpoint, and the login path runs a dummy comparison for unknown users so
response timing does not reveal whether an address exists.

**Roles.** ``admin`` can change risk limits and touch the live-mode gate;
``operator`` can approve trades and use emergency controls; ``viewer`` reads
everything; ``readonly`` reads everything and is explicitly denied every mutation.

**Lockout.** Repeated failures lock an account for a cooling-off period, which
turns credential stuffing from cheap into expensive.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import bcrypt
from fastapi import Depends, HTTPException, Request, Response, status
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.orm import Session

from aegisquant.config import get_settings
from aegisquant.db import enums as E
from aegisquant.db.models import AuditLog, User
from aegisquant.db.session import get_session
from aegisquant.logging_setup import get_logger
from aegisquant.utils.timeutil import utcnow

log = get_logger(__name__)

ALGORITHM = "HS256"
BCRYPT_ROUNDS = 12
MAX_FAILED_LOGINS = 5
LOCKOUT_MINUTES = 15

ROLE_RANK = {
    E.Role.READONLY: 0,
    E.Role.VIEWER: 1,
    E.Role.OPERATOR: 2,
    E.Role.ADMIN: 3,
}


def _prepare(raw: str) -> bytes:
    """SHA-256 then base64, so the whole password contributes to the bcrypt input.

    Without this, bcrypt would silently ignore everything past byte 72 — a
    passphrase-shaped password would be far weaker than it looks.
    """
    digest = hashlib.sha256(raw.encode("utf-8")).digest()
    return base64.b64encode(digest)


def hash_password(raw: str) -> str:
    return bcrypt.hashpw(_prepare(raw), bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode("ascii")


def verify_password(raw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_prepare(raw), hashed.encode("ascii"))
    except (ValueError, TypeError):  # malformed or truncated hash
        return False


#: A precomputed hash so verifying a non-existent user costs the same as a real
#: one, which stops the login endpoint leaking which addresses exist.
_DUMMY_HASH = hash_password("aegisquant-timing-equaliser")


# ---------------------------------------------------------------------------
def create_access_token(user: User, expires_minutes: int | None = None) -> str:
    settings = get_settings()
    minutes = expires_minutes or settings.access_token_ttl_minutes
    now = utcnow()
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "role": user.role.value,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=minutes)).timestamp()),
        "jti": secrets.token_urlsafe(8),
    }
    return jwt.encode(payload, settings.secret_key.get_secret_value(), algorithm=ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    try:
        return jwt.decode(token, settings.secret_key.get_secret_value(), algorithms=[ALGORITHM])
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired session") from exc


def set_session_cookies(response: Response, token: str) -> str:
    """Set the session cookie plus a readable CSRF token."""
    settings = get_settings()
    csrf = secrets.token_urlsafe(24)
    response.set_cookie(
        settings.cookie_name,
        token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=settings.access_token_ttl_minutes * 60,
        path="/",
    )
    response.set_cookie(
        settings.csrf_cookie_name,
        csrf,
        httponly=False,  # the SPA must read it to echo it back
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=settings.access_token_ttl_minutes * 60,
        path="/",
    )
    return csrf


def clear_session_cookies(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(settings.cookie_name, path="/")
    response.delete_cookie(settings.csrf_cookie_name, path="/")


# ---------------------------------------------------------------------------
@dataclass(slots=True)
class CurrentUser:
    id: int
    email: str
    role: E.Role

    def at_least(self, role: E.Role) -> bool:
        return ROLE_RANK[self.role] >= ROLE_RANK[role]


def get_current_user(request: Request, session: Session = Depends(get_session)) -> CurrentUser:
    settings = get_settings()
    token = request.cookies.get(settings.cookie_name)
    if not token:
        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    payload = decode_token(token)
    user = session.get(User, int(payload["sub"]))
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account is inactive")
    return CurrentUser(id=user.id, email=user.email, role=user.role)


def require_role(minimum: E.Role):
    """Dependency factory enforcing a minimum role."""

    def _dependency(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if not user.at_least(minimum):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"This action requires the {minimum.value} role",
            )
        return user

    return _dependency


require_viewer = require_role(E.Role.VIEWER)
require_operator = require_role(E.Role.OPERATOR)
require_admin = require_role(E.Role.ADMIN)


def require_csrf(request: Request) -> None:
    """Double-submit CSRF check for state-changing requests."""
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return
    settings = get_settings()
    cookie = request.cookies.get(settings.csrf_cookie_name)
    header = request.headers.get("x-csrf-token")
    if not cookie or not header or not hmac.compare_digest(cookie, header):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF token missing or invalid")


def mutating(user: CurrentUser = Depends(require_operator), _: None = Depends(require_csrf)) -> CurrentUser:
    """Dependency for every mutating endpoint: operator role plus CSRF."""
    return user


def admin_mutating(user: CurrentUser = Depends(require_admin), _: None = Depends(require_csrf)) -> CurrentUser:
    return user


# ---------------------------------------------------------------------------
class RateLimiter:
    """Sliding-window per-identity limiter."""

    def __init__(self, per_minute: int) -> None:
        self.per_minute = per_minute
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, identity: str, limit: int | None = None) -> bool:
        limit = limit or self.per_minute
        now = time.monotonic()
        window = self._hits[identity]
        while window and now - window[0] > 60:
            window.popleft()
        if len(window) >= limit:
            return False
        window.append(now)
        return True


_RATE_LIMITER: RateLimiter | None = None


def get_rate_limiter() -> RateLimiter:
    global _RATE_LIMITER
    if _RATE_LIMITER is None:
        _RATE_LIMITER = RateLimiter(get_settings().rate_limit_per_minute)
    return _RATE_LIMITER


# ---------------------------------------------------------------------------
def authenticate(session: Session, email: str, password: str) -> tuple[User | None, str | None]:
    """Verify credentials. Returns ``(user, error)``; the error is deliberately vague."""
    user = session.scalar(select(User).where(User.email == email.lower().strip()))
    if user is None:
        verify_password(password, _DUMMY_HASH)  # equalise timing
        return None, "Invalid email or password"
    if user.locked_until and user.locked_until > utcnow():
        remaining = int((user.locked_until - utcnow()).total_seconds() / 60) + 1
        return None, f"Account is locked. Try again in {remaining} minute(s)."
    if not user.is_active:
        return None, "Invalid email or password"
    if not verify_password(password, user.password_hash):
        user.failed_logins = (user.failed_logins or 0) + 1
        if user.failed_logins >= MAX_FAILED_LOGINS:
            user.locked_until = utcnow() + timedelta(minutes=LOCKOUT_MINUTES)
            user.failed_logins = 0
            log.warning("account_locked", email=user.email)
        return None, "Invalid email or password"
    user.failed_logins = 0
    user.locked_until = None
    user.last_login_at = utcnow()
    return user, None


def record_audit(
    session: Session,
    *,
    actor: str,
    actor_role: str | None,
    action: str,
    target: str | None = None,
    method: str | None = None,
    path: str | None = None,
    status_code: int | None = None,
    ip: str | None = None,
    detail: dict[str, Any] | None = None,
) -> None:
    session.add(
        AuditLog(
            at=utcnow(),
            actor=actor,
            actor_role=actor_role,
            action=action,
            target=target,
            method=method,
            path=path,
            status_code=status_code,
            ip=ip,
            detail=_redact(detail) if detail else None,
        )
    )


_SENSITIVE = {"password", "confirmation_phrase", "secret", "token", "api_key"}


def _redact(payload: dict[str, Any]) -> dict[str, Any]:
    return {k: ("***REDACTED***" if any(s in k.lower() for s in _SENSITIVE) else v) for k, v in payload.items()}


def ensure_bootstrap_admin(session: Session) -> User:
    """Create the bootstrap admin if no users exist yet."""
    settings = get_settings()
    existing = session.scalar(select(User).limit(1))
    if existing is not None:
        return existing
    user = User(
        email=settings.bootstrap_admin_email.lower(),
        password_hash=hash_password(settings.bootstrap_admin_password.get_secret_value()),
        role=E.Role.ADMIN,
        is_active=True,
    )
    session.add(user)
    session.flush()
    log.warning(
        "bootstrap_admin_created",
        email=user.email,
        note="change this password immediately outside development",
    )
    return user


def utc_expiry(minutes: int) -> datetime:
    return utcnow() + timedelta(minutes=minutes)
