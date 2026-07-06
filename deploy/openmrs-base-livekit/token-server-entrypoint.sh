#!/bin/sh
set -eu

if [ "$(id -u)" = "0" ]; then
  mkdir -p /data
  chown -R app:app /data
  exec su app -s /bin/sh -c 'python token-server/server.py'
fi

exec python token-server/server.py
