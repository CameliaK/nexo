#!/usr/bin/env bash
# Backup de Nexo: Postgres (pg_dump) + workflows de n8n.
# Ejecutar desde la raíz del repo con el stack levantado.
# Uso:  make backup        (desarrollo)
#       make backup-prod   (VPS; el cron está en docs/despliegue.md)
set -euo pipefail
# Los respaldos llevan datos personales (correos, mensajes del chat en vivo):
# solo los lee el usuario que los crea.
umask 077

# Sin -f, docker compose también cargaría docker-compose.override.yml (dev).
# En producción: COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml"
COMPOSE="docker compose ${COMPOSE_FILES:-}"

BACKUP_DIR="${BACKUP_DIR:-./backups}"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR"

# ── Postgres ──────────────────────────────────────────────────────────────────
DB_FILE="$BACKUP_DIR/nexo_db_${DATE}.sql.gz"
echo "[backup] pg_dump → $DB_FILE"
# --clean --if-exists: el volcado se puede restaurar sobre una base existente.
$COMPOSE exec -T postgres \
  pg_dump -U nexo --clean --if-exists nexo | gzip > "$DB_FILE"
gzip -t "$DB_FILE"
echo "[backup] DB: $(du -h "$DB_FILE" | cut -f1)"

# ── n8n workflows ─────────────────────────────────────────────────────────────
WF_FILE="$BACKUP_DIR/n8n_workflows_${DATE}.json"
echo "[backup] n8n export:workflow → $WF_FILE"
CONTAINER_ID=$($COMPOSE ps -q n8n)
docker exec "$CONTAINER_ID" \
  n8n export:workflow --all --output=/tmp/nexo_wf_export.json
docker cp "$CONTAINER_ID":/tmp/nexo_wf_export.json "$WF_FILE"
docker exec "$CONTAINER_ID" rm -f /tmp/nexo_wf_export.json
chmod 600 "$WF_FILE"  # docker cp keeps the container file's mode
echo "[backup] workflows: $(du -h "$WF_FILE" | cut -f1)"

# ── Limpieza de backups antiguos (> 30 días) ───────────────────────────────────
find "$BACKUP_DIR" -name "nexo_db_*.sql.gz" -mtime +30 -delete
find "$BACKUP_DIR" -name "n8n_workflows_*.json" -mtime +30 -delete

echo "[backup] done — $DATE"
