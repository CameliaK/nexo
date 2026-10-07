COMPOSE      = docker compose
COMPOSE_PROD = docker compose -f docker-compose.yml -f docker-compose.prod.yml

.PHONY: dev down gen-key prod-up prod-down prod-logs prod-config backup backup-prod restore-test

# ── Desarrollo ────────────────────────────────────────────────────────────────
# docker-compose.override.yml se auto-carga: añade puertos 8888 (Traefik) y
# 5678 (n8n) que NO deben estar expuestos en producción.
dev:
	$(COMPOSE) up --build

down:
	$(COMPOSE) down

# Genera PASETO_LOCAL_KEY y la añade a .env si aún no existe.
gen-key:
	@if grep -q '^PASETO_LOCAL_KEY=' .env 2>/dev/null; then \
		echo "PASETO_LOCAL_KEY ya existe en .env — borra la línea manualmente si quieres regenerarla"; \
	else \
		python3 -c "import secrets; print('PASETO_LOCAL_KEY=' + secrets.token_hex(32))" >> .env; \
		echo "PASETO_LOCAL_KEY escrita en .env"; \
	fi

# ── Producción ────────────────────────────────────────────────────────────────
# Valida y levanta el stack con el override de producción (build con caché).
# La primera vez que se levanta con un dominio real, Traefik obtiene el cert
# automáticamente vía Let's Encrypt HTTP-01 (port 80 debe ser alcanzable); lo
# guarda en el volumen traefik_acme.
prod-up: prod-config
	$(COMPOSE_PROD) up -d --build

prod-down:
	$(COMPOSE_PROD) down

prod-logs:
	$(COMPOSE_PROD) logs -f

# Valida el compose combinado (sintaxis y variables obligatorias) sin levantar
# nada y sin imprimirlo: la salida completa de `config` lleva los secretos.
prod-config:
	@$(COMPOSE_PROD) config --quiet && echo "prod-config: OK"

# ── Backups ───────────────────────────────────────────────────────────────────
# pg_dump comprimido + export de workflows de n8n → ./backups/
# backup usa el compose de desarrollo (cifra solo si pasas AGE_RECIPIENTS);
# backup-prod exige el archivo de destinatarios de age (clave pública) y nunca
# deja un respaldo en claro. Ver docs/despliegue.md §12.
AGE_RECIPIENTS ?= ./backup-recipients.txt

backup:
	@bash scripts/backup.sh

backup-prod:
	@COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml" \
		AGE_RECIPIENTS="$(AGE_RECIPIENTS)" REQUIRE_AGE=1 bash scripts/backup.sh

# Descifra un respaldo y lo carga en un Postgres desechable (en tu Mac, donde
# está la clave privada). make restore-test FILE=backups/nexo_db_….sql.gz.age
restore-test:
	@bash scripts/restore-test.sh "$(FILE)"
