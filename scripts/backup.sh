#!/usr/bin/env bash
# Backup de Nexo: Postgres (pg_dump) + workflows de n8n, cifrados con age.
# Ejecutar desde la raíz del repo con el stack levantado.
# Uso:  make backup        (desarrollo)
#       make backup-prod   (VPS; el cron está en docs/despliegue.md)
#
# Cifrado: si AGE_RECIPIENTS apunta a un archivo de destinatarios de age (una
# clave pública age1… por línea), todo se cifra en el mismo tubo: el volcado
# en claro nunca toca el disco del host. La clave privada no está en el
# servidor: descifrar y restaurar se hace desde fuera (scripts/restore-test.sh).
# REQUIRE_AGE=1 (backup-prod) falla si no hay destinatarios, en vez de dejar
# un respaldo en claro.
set -euo pipefail
# Los respaldos llevan datos personales (correos, mensajes del chat en vivo):
# solo los lee el usuario que los crea.
umask 077

# Sin -f, docker compose también cargaría docker-compose.override.yml (dev).
# En producción: COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml"
COMPOSE="docker compose ${COMPOSE_FILES:-}"

BACKUP_DIR="${BACKUP_DIR:-./backups}"
AGE_RECIPIENTS="${AGE_RECIPIENTS:-}"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR"

if [[ -n "$AGE_RECIPIENTS" ]]; then
  [[ -r "$AGE_RECIPIENTS" ]] || { echo "[backup] AGE_RECIPIENTS=$AGE_RECIPIENTS no se puede leer" >&2; exit 1; }
  command -v age >/dev/null || { echo "[backup] falta age (sudo apt-get install age)" >&2; exit 1; }
  grep -q '^age1' "$AGE_RECIPIENTS" || { echo "[backup] $AGE_RECIPIENTS no tiene ninguna clave age1…" >&2; exit 1; }
  EXT=".age"
  seal() { age -R "$AGE_RECIPIENTS"; }
elif [[ "${REQUIRE_AGE:-0}" == "1" ]]; then
  echo "[backup] REQUIRE_AGE=1 y AGE_RECIPIENTS vacío: no se hace un respaldo en claro" >&2
  exit 1
else
  EXT=""
  seal() { cat; }
fi

# Un fallo a medias no deja un archivo truncado que parezca bueno.
PARTIAL=()
trap 'rm -f "${PARTIAL[@]}"' ERR

# ── Postgres ──────────────────────────────────────────────────────────────────
DB_FILE="$BACKUP_DIR/nexo_db_${DATE}.sql.gz${EXT}"
PARTIAL+=("$DB_FILE")
echo "[backup] pg_dump → $DB_FILE"
# --clean --if-exists: el volcado se puede restaurar sobre una base existente.
# pipefail: si pg_dump falla, el script falla aunque gzip y age terminen bien.
$COMPOSE exec -T postgres \
  pg_dump -U nexo --clean --if-exists nexo | gzip | seal > "$DB_FILE"
if [[ -z "$EXT" ]]; then
  gzip -t "$DB_FILE"
else
  # Sin la clave privada no se puede comprobar el contenido aquí; al menos que
  # sea un archivo age completo (la cabecera y algo de carga).
  head -c 21 "$DB_FILE" | grep -q '^age-encryption.org/v1' || { echo "[backup] $DB_FILE no es un archivo age" >&2; false; }
fi
echo "[backup] DB: $(du -h "$DB_FILE" | cut -f1)"

# ── n8n workflows ─────────────────────────────────────────────────────────────
WF_FILE="$BACKUP_DIR/n8n_workflows_${DATE}.json${EXT}"
PARTIAL+=("$WF_FILE")
echo "[backup] n8n export:workflow → $WF_FILE"
CONTAINER_ID=$($COMPOSE ps -q n8n)
docker exec "$CONTAINER_ID" \
  n8n export:workflow --all --output=/tmp/nexo_wf_export.json >/dev/null
docker exec "$CONTAINER_ID" cat /tmp/nexo_wf_export.json | seal > "$WF_FILE"
docker exec "$CONTAINER_ID" rm -f /tmp/nexo_wf_export.json
echo "[backup] workflows: $(du -h "$WF_FILE" | cut -f1)"
trap - ERR

# ── Limpieza de backups antiguos (> 30 días) ───────────────────────────────────
find "$BACKUP_DIR" \( -name "nexo_db_*.sql.gz*" -o -name "n8n_workflows_*.json*" \) -mtime +30 -delete

echo "[backup] done — $DATE"
