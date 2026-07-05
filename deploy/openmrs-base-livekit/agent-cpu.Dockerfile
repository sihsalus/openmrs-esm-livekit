# syntax=docker/dockerfile:1

ARG PYTHON_VERSION=3.12
FROM python:${PYTHON_VERSION}-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/app/.cache/huggingface \
    PROMETHEUS_MULTIPROC_DIR=/tmp/prometheus_multiproc

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gcc \
    g++ \
    libgomp1 \
    python3-dev \
    tar \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml requirements.lock ./

RUN pip install --upgrade pip \
    && pip install -r requirements.lock \
    && pip install "faster-whisper>=1.0,<2.0"

RUN mkdir -p /srv/piper/voices /tmp/piper-download

COPY vendor/piper/piper_linux_x86_64.tar.gz /tmp/piper-download/piper_linux_x86_64.tar.gz
COPY vendor/piper/es_MX-claude-high.onnx /srv/piper/voices/es_MX-claude-high.onnx
COPY vendor/piper/es_MX-claude-high.onnx.json /srv/piper/voices/es_MX-claude-high.onnx.json

RUN tar -xzf /tmp/piper-download/piper_linux_x86_64.tar.gz -C /srv/piper \
    && chmod +x /srv/piper/piper/piper \
    && /srv/piper/piper/piper --help >/dev/null \
    && rm -rf /tmp/piper-download

COPY src/ ./src/

ENV PYTHONPATH=/app

RUN mkdir -p /tmp/prometheus_multiproc /app/.cache/huggingface \
    && chmod 777 /tmp/prometheus_multiproc \
    && OPENAI_API_KEY=dummy \
       TTS_PROVIDER=openai \
       STT_PROVIDER=openai \
       LIVEKIT_URL=ws://dummy \
       LIVEKIT_API_KEY=dummy \
       LIVEKIT_API_SECRET=dummy \
       python src/agent.py download-files

ARG UID=10001
RUN adduser \
    --disabled-password \
    --gecos "" \
    --home "/app" \
    --shell "/sbin/nologin" \
    --uid "${UID}" \
    appuser \
    && chown -R appuser:appuser /app /srv/piper /tmp/prometheus_multiproc

USER appuser

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/metrics', timeout=5)" || exit 1

EXPOSE 8000

CMD ["python", "src/agent.py", "start"]
