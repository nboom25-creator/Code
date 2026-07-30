# AegisQuant backend: API, worker and scheduler all run from this image.
# The entrypoint is chosen by the compose service command.
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# libpq for psycopg2, curl for the container health check. No compilers in the
# final image: every dependency ships a wheel for this platform.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first, so a source change does not invalidate the layer.
COPY pyproject.toml ./
RUN pip install --no-cache-dir -e . 2>/dev/null || true

COPY aegisquant ./aegisquant
COPY alembic ./alembic
COPY alembic.ini ./
COPY tests ./tests
RUN pip install --no-cache-dir -e ".[dev]"

# Run as an unprivileged user: nothing in here needs root, and the container has
# database credentials in its environment.
RUN useradd --create-home --uid 10001 aegis && chown -R aegis:aegis /app
USER aegis

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS http://localhost:8000/api/health || exit 1

CMD ["python", "-m", "aegisquant.cli", "serve", "--host", "0.0.0.0", "--port", "8000"]
