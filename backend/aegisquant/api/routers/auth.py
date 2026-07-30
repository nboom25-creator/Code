"""Authentication endpoints."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import select
from sqlalchemy.orm import Session

from aegisquant.api.security import (
    CurrentUser,
    admin_mutating,
    authenticate,
    clear_session_cookies,
    create_access_token,
    get_current_user,
    get_rate_limiter,
    hash_password,
    record_audit,
    require_csrf,
    set_session_cookies,
    verify_password,
)
from aegisquant.db import enums as E
from aegisquant.db.models import User
from aegisquant.db.session import get_session

router = APIRouter(tags=["auth"])

#: Deliberately permissive rather than RFC-strict. A self-hosted deployment
#: routinely uses reserved-domain addresses (``admin@company.internal``,
#: ``ops@aegisquant.local``), and a strict validator rejects exactly those.
EmailAddress = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        to_lower=True,
        min_length=3,
        max_length=255,
        pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$",
    ),
]


class LoginRequest(BaseModel):
    email: EmailAddress
    password: str = Field(min_length=1, max_length=200)


class UserOut(BaseModel):
    """User representation. Deliberately has no password field of any kind."""

    id: int
    email: str
    role: str
    is_active: bool


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=12, max_length=200)


class UserCreate(BaseModel):
    email: EmailAddress
    password: str = Field(min_length=12, max_length=200)
    role: E.Role = E.Role.VIEWER


@router.post("/auth/login")
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    ip = request.client.host if request.client else "unknown"
    # Login is rate-limited far more tightly than the general API.
    if not get_rate_limiter().check(f"login:{ip}", limit=10):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Try again shortly.",
        )
    user, error = authenticate(session, payload.email, payload.password)
    if user is None:
        record_audit(
            session,
            actor=payload.email,
            actor_role=None,
            action="login_failed",
            ip=ip,
            status_code=401,
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=error)

    token = create_access_token(user)
    csrf = set_session_cookies(response, token)
    record_audit(
        session,
        actor=user.email,
        actor_role=user.role.value,
        action="login",
        ip=ip,
        status_code=200,
    )
    return {
        "user": UserOut(id=user.id, email=user.email, role=user.role.value, is_active=user.is_active).model_dump(),
        "csrf_token": csrf,
    }


@router.post("/auth/logout")
def logout(
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
    session: Session = Depends(get_session),
    _: None = Depends(require_csrf),
) -> dict[str, str]:
    clear_session_cookies(response)
    record_audit(
        session,
        actor=user.email,
        actor_role=user.role.value,
        action="logout",
        ip=request.client.host if request.client else None,
    )
    return {"detail": "Signed out"}


@router.get("/auth/me")
def me(user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    return {"id": user.id, "email": user.email, "role": user.role.value}


@router.post("/auth/password")
def change_password(
    payload: PasswordChange,
    request: Request,
    user: CurrentUser = Depends(get_current_user),
    session: Session = Depends(get_session),
    _: None = Depends(require_csrf),
) -> dict[str, str]:
    row = session.get(User, user.id)
    if row is None or not verify_password(payload.current_password, row.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    row.password_hash = hash_password(payload.new_password)
    record_audit(
        session,
        actor=user.email,
        actor_role=user.role.value,
        action="password_changed",
        ip=request.client.host if request.client else None,
    )
    return {"detail": "Password updated"}


@router.get("/auth/users")
def list_users(
    user: CurrentUser = Depends(admin_mutating), session: Session = Depends(get_session)
) -> list[dict[str, Any]]:
    return [
        UserOut(id=u.id, email=u.email, role=u.role.value, is_active=u.is_active).model_dump()
        for u in session.scalars(select(User).order_by(User.email))
    ]


@router.post("/auth/users", status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    request: Request,
    user: CurrentUser = Depends(admin_mutating),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    existing = session.scalar(select(User).where(User.email == payload.email.lower()))
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A user with that email already exists")
    row = User(
        email=payload.email.lower(),
        password_hash=hash_password(payload.password),
        role=payload.role,
        is_active=True,
    )
    session.add(row)
    session.flush()
    record_audit(
        session,
        actor=user.email,
        actor_role=user.role.value,
        action="user_created",
        target=row.email,
        detail={"role": payload.role.value},
        ip=request.client.host if request.client else None,
    )
    return UserOut(id=row.id, email=row.email, role=row.role.value, is_active=row.is_active).model_dump()
