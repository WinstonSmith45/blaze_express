# syntax=docker/dockerfile:1
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DJANGO_DB_PATH=/app/db/db.sqlite3

# Cron for containers: runs run.sh on schedule in the collector service.
ARG SUPERCRONIC_VERSION=v0.2.49
ARG SUPERCRONIC_SHA256=a53ae236602c7338aba3fbaff40bda6300eae3b9fedb8261eb06cfe3724430c1
ADD --checksum=sha256:${SUPERCRONIC_SHA256} \
    https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-amd64 \
    /usr/local/bin/supercronic
RUN chmod +x /usr/local/bin/supercronic

# Match the host user so files in the mounted data/ and db/ stay writable.
ARG APP_UID=1000
ARG APP_GID=1000
RUN groupadd -g ${APP_GID} app && useradd -u ${APP_UID} -g ${APP_GID} -m -s /usr/sbin/nologin app

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN DJANGO_DEBUG=1 python manage.py collectstatic --noinput \
    && mkdir -p data db \
    && chown app:app data db

USER app
EXPOSE 8000
CMD ["sh", "-c", "python manage.py migrate --noinput && exec gunicorn dashboard_site.wsgi --bind 0.0.0.0:8000 --workers 2 --access-logfile -"]
