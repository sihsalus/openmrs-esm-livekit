FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

COPY token-server/requirements.txt /app/token-server/requirements.txt
RUN pip install --no-cache-dir -r /app/token-server/requirements.txt \
    && groupadd --system app \
    && useradd --system --gid app --home-dir /app app

COPY token-server /app/token-server
RUN chown -R app:app /app

EXPOSE 7890

USER app

CMD ["python", "token-server/server.py"]
