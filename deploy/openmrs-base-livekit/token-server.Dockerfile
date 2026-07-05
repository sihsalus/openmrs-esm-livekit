FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

COPY token-server /app/token-server

EXPOSE 7890

CMD ["python", "token-server/server.py"]
