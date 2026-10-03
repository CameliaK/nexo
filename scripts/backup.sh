#!/usr/bin/env bash
# Backup de Nexo: Postgres (pg_dump) + workflows de n8n.
# Ejecutar desde la raíz del repo con el stack levantado.
# Uso:  make backup
#       0 3 * * * cd /opt/nexo && make backup >> /var/log/nexo-backup.log 2>&1
set -euo pipefail

BACKUP_DIR="./backups"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR"

# ── Postgres ──────────────────────────────────────────────────────────────────
DB_FILE="$BACKUP_DIR/nexo_db_${DATE}.sql.gz"
echo "[backup] pg_dump → $DB_FILE"
docker compose exec -T postgres \
  pg_dump -U nexo nexo | gzip > "$DB_FILE"
echo "[backup] DB: $(du -h "$DB_FILE" | cut -f1)"

# ── n8n workflows ─────────────────────────────────────────────────────────────
WF_FILE="$BACKUP_DIR/n8n_workflows_${DATE}.json"
echo "[backup] n8n export:workflow → $WF_FILE"
CONTAINER_ID=$(docker compose ps -q n8n)
docker exec "$CONTAINER_ID" \
  n8n export:workflow --all --output=/tmp/nexo_wf_export.json
docker cp "$CONTAINER_ID":/tmp/nexo_wf_export.json "$WF_FILE"
echo "[backup] workflows: $(du -h "$WF_FILE" | cut -f1)"

# ── Limpieza de backups antiguos (> 30 días) ───────────────────────────────────
find "$BACKUP_DIR" -name "nexo_db_*.sql.gz" -mtime +30 -delete
find "$BACKUP_DIR" -name "n8n_workflows_*.json" -mtime +30 -delete

echo "[backup] done — $DATE"
