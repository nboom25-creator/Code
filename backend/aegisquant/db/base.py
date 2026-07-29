"""Declarative base and shared column types."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import DateTime, MetaData, Numeric, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# Explicit naming convention keeps Alembic autogenerate stable across backends.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

Money = Numeric(24, 10, asdecimal=True)
Qty = Numeric(24, 10, asdecimal=True)
Ratio = Numeric(18, 10, asdecimal=True)
UtcDateTime = DateTime(timezone=True)


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)

    type_annotation_map = {
        Decimal: Money,
        datetime: UtcDateTime,
        dict[str, Any]: __import__("sqlalchemy").JSON,
    }


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        UtcDateTime, server_default=func.now(), nullable=False, index=True
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        UtcDateTime, onupdate=func.now(), nullable=True
    )
