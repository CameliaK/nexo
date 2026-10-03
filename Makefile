COMPOSE      = docker compose
COMPOSE_PROD = docker compose -f docker-compose.yml -f docker-compose.prod.yml

.PHONY: dev down gen-key prod-up prod-down prod-logs prod-config backup

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
# Prepara acme.json (600) y levanta el stack con el override de producción.
# La primera vez que se levanta con un dominio real, Traefik obtiene el cert
# automáticamente vía Let's Encrypt HTTP-01 (port 80 debe ser alcanzable).
prod-up:
	@mkdir -p traefik
	@[ -f traefik/acme.json ] || touch traefik/acme.json
	@chmod 600 traefik/acme.json
	$(COMPOSE_PROD) up -d --build

prod-down:
	$(COMPOSE_PROD) down

prod-logs:
	$(COMPOSE_PROD) logs -f

# Valida la sintaxis del compose combinado sin levantar nada.
prod-config:
	$(COMPOSE_PROD) config

# ── Backups ───────────────────────────────────────────────────────────────────
# pg_dump comprimido + export de workflows de n8n → ./backups/
# Para cron: 0 3 * * * cd /opt/nexo && make backup >> /var/log/nexo-backup.log 2>&1
backup:
	@bash scripts/backup.sh
