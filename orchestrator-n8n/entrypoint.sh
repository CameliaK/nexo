#!/bin/sh
set -e

# Create instance owner first — n8n import:workflow needs the owner's personal
# project to exist or it throws "Could not find any entity of type Project".
# Idempotent: skips rows that already exist.
node /scripts/setup-owner.js

# Import workflow definitions on every startup.
# Stable "id" fields ensure n8n updates existing workflows, not duplicates.
# n8n import:workflow always imports as inactive AND clears webhook_entity,
# so activate-via-api.js re-activates them via REST after n8n is ready.
n8n import:workflow --input=/workflows/nexo-deep-route.json
n8n import:workflow --input=/workflows/nexo-live-chat.json

# Start n8n in the background so the REST API is available for activation.
n8n start &
N8N_PID=$!

# Wait for n8n to respond, then activate workflows via REST.
# This is the only path that correctly populates webhook_entity.
node /scripts/activate-via-api.js

# Forward SIGTERM/SIGINT to n8n and wait for it to exit.
trap "kill -TERM $N8N_PID 2>/dev/null" TERM INT
wait $N8N_PID
