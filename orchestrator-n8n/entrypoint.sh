#!/bin/sh
set -e

if [ -z "$N8N_OWNER_PASSWORD" ]; then
  echo "entrypoint: N8N_OWNER_PASSWORD is not set — refusing to start n8n without an owner password" >&2
  exit 1
fi

# First boot: the instance owner must exist before n8n import:workflow, which
# needs the owner's personal project ("Could not find any entity of type
# Project"). On a fresh volume there are no tables yet, so n8n starts once on
# its own (it runs its migrations and creates a placeholder owner), the owner
# is claimed through its REST API, and n8n stops again. With a volume that
# already has an owner this whole block is skipped and nothing is touched.
OWNER_STATE=0
node /scripts/owner-state.js || OWNER_STATE=$?
if [ "$OWNER_STATE" -eq 3 ]; then
  echo "entrypoint: first boot — starting n8n once to create its database and owner"
  n8n start &
  BOOT_PID=$!
  trap "kill -TERM $BOOT_PID 2>/dev/null" TERM INT
  if ! node /scripts/owner-setup.js; then
    echo "entrypoint: owner setup FAILED — n8n was not configured. See docs/despliegue.md (n8n: primer arranque)" >&2
    kill -TERM $BOOT_PID 2>/dev/null || true
    wait $BOOT_PID 2>/dev/null || true
    exit 1
  fi
  kill -TERM $BOOT_PID
  wait $BOOT_PID || true
  trap - TERM INT
  echo "entrypoint: first boot setup done"
elif [ "$OWNER_STATE" -ne 0 ]; then
  echo "entrypoint: could not read the n8n database state" >&2
  exit 1
fi

# Import workflow definitions on every startup.
# Stable "id" fields ensure n8n updates existing workflows, not duplicates.
# n8n import:workflow always imports as inactive AND clears webhook_entity,
# so activate-via-api.js re-activates them via REST after n8n is ready.
n8n import:workflow --input=/workflows/nexo-deep-route.json
n8n import:workflow --input=/workflows/nexo-live-chat.json
n8n import:workflow --input=/workflows/nexo-live-inbound.json

# Start n8n in the background so the REST API is available for activation.
n8n start &
N8N_PID=$!

# Wait for n8n to respond, then activate workflows via REST.
# This is the only path that correctly populates webhook_entity.
node /scripts/activate-via-api.js

# Forward SIGTERM/SIGINT to n8n and wait for it to exit.
trap "kill -TERM $N8N_PID 2>/dev/null" TERM INT
wait $N8N_PID
