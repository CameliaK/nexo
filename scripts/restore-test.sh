#!/usr/bin/env bash
# Prueba de restauración de un respaldo cifrado, en una base desechable.
# Se corre donde está la clave privada de age (tu Mac), no en el VPS.
#
# Uso:  make restore-test FILE=backups/nexo_db_<fecha>.sql.gz.age [AGE_IDENTITY=~/.config/nexo/backup-key.txt]
#
# Levanta un Postgres temporal (misma imagen que producción, sin volumen),
# descifra y carga el volcado en un tubo (el SQL en claro no se escribe en
# disco), lista las tablas con su número de filas y borra el contenedor.
set -euo pipefail

FILE="${1:?uso: restore-test.sh <archivo .sql.gz.age o .sql.gz>}"
IDENTITY="${AGE_IDENTITY:-$HOME/.config/nexo/backup-key.txt}"
IMAGE="pgvector/pgvector:pg17"
NAME="nexo-restore-test-$$"

[[ -r "$FILE" ]] || { echo "[restore-test] no se puede leer $FILE" >&2; exit 1; }
if [[ "$FILE" == *.age ]]; then
  command -v age >/dev/null || { echo "[restore-test] falta age (brew install age)" >&2; exit 1; }
  [[ -r "$IDENTITY" ]] || { echo "[restore-test] no encuentro la clave privada en $IDENTITY (AGE_IDENTITY=…)" >&2; exit 1; }
  open_dump() { age -d -i "$IDENTITY" "$FILE" | gunzip; }
else
  open_dump() { gunzip -c "$FILE"; }
fi

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "[restore-test] Postgres temporal $NAME ($IMAGE)"
docker run -d --rm --name "$NAME" -e POSTGRES_USER=nexo -e POSTGRES_PASSWORD=restore-test \
  -e POSTGRES_DB=nexo "$IMAGE" >/dev/null
for _ in $(seq 60); do
  docker exec "$NAME" pg_isready -U nexo -d nexo -q 2>/dev/null && break
  sleep 1
done
# pg_isready responde durante el arranque inicial del entrypoint; esperar al
# servidor definitivo.
until docker exec "$NAME" psql -U nexo -d nexo -tAc "select 1" >/dev/null 2>&1; do sleep 1; done

echo "[restore-test] descifrando y cargando $FILE"
open_dump | docker exec -i "$NAME" psql -U nexo -d nexo -q -v ON_ERROR_STOP=1 >/dev/null

echo "[restore-test] tablas restauradas (filas):"
docker exec "$NAME" psql -U nexo -d nexo -P pager=off -c "
  SELECT table_name AS tabla,
         (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I', table_name), false, true, '')))[1]::text::int AS filas
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ORDER BY 1"
echo "[restore-test] OK — el contenedor temporal se borra al salir"
