#!/bin/sh
set -e

# Generate .htpasswd from environment variables at container startup
# This way credentials are never baked into the Docker image
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-}"

if [ -z "$ADMIN_PASS" ]; then
  echo "ERROR: ADMIN_PASS environment variable is not set. Refusing to start without a password."
  exit 1
fi

htpasswd -bc /etc/nginx/.htpasswd "$ADMIN_USER" "$ADMIN_PASS"
echo "Auth configured for user: $ADMIN_USER"

exec "$@"
