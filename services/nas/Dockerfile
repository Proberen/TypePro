FROM python:3.13-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TYPEPRO_DATA_DIR=/data
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir --only-binary=:all: -r requirements.txt \
    && groupadd --gid 10001 typepro \
    && useradd --uid 10001 --gid typepro --no-create-home typepro \
    && mkdir -p /data && chown typepro:typepro /data
COPY --chown=typepro:typepro app ./app
COPY --chown=typepro:typepro web ./web
USER typepro
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=3).close()"]
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--no-proxy-headers", "--no-access-log"]
