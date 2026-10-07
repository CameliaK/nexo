#!/usr/bin/env bash
# Comprueba el .env de producción sin imprimir ningún valor: solo nombres y
# qué falla. Uso: make prod-check   (ENV_FILE=… para otro archivo)
#
# Obligatorias: todas las ${VAR:?} de docker-compose.prod.yml (se leen de ahí,
# así una nueva no se olvida) más las que la producción necesita aunque el
# compose no las exija (correo, Google, dueño). Además, formatos y valores de
# desarrollo publicados en el repo.
set -uo pipefail
cd "$(dirname "$0")/.."
ENV_FILE="${ENV_FILE:-.env}"
[[ -r "$ENV_FILE" ]] || { echo "prod-check: no se puede leer $ENV_FILE"; exit 1; }

# Valor de una variable en el .env (última asignación gana, comillas fuera),
# sin evaluar nada del archivo.
val() {
  local line
  line=$(grep -E "^[[:space:]]*(export[[:space:]]+)?$1=" "$ENV_FILE" | tail -1) || true
  line="${line#*=}"
  line="${line%$'\r'}"
  if [[ "$line" =~ ^\"(.*)\"$ || "$line" =~ ^\'(.*)\'$ ]]; then line="${BASH_REMATCH[1]}"; fi
  printf '%s' "$line"
}

fail=0
bad() { echo "  ✗ $1"; fail=1; }

REQUIRED=$(grep -vE '^[[:space:]]*#' docker-compose.prod.yml | grep -oE '\$\{[A-Z0-9_]+:\?' | sed -E 's/\$\{([A-Z0-9_]+):\?/\1/' | sort -u)
# Producción completa: correo (Resend), login con Google y dueño.
REQUIRED+=$'\n'"OWNER_EMAIL SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS SMTP_TLS MAIL_FROM GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_REDIRECT_URL"

echo "prod-check: $ENV_FILE"
n=0
for v in $REQUIRED; do
  n=$((n + 1))
  [[ -n "$(val "$v")" ]] || bad "$v no está definida"
done
echo "  $n variables obligatorias revisadas"

DOMAIN=$(val DOMAIN); PUB=$(val PUBLIC_BASE_URL)
[[ -z "$DOMAIN" || "$DOMAIN" =~ ^[a-z0-9.-]+$ ]] || bad "DOMAIN debe ser solo el host (sin https:// ni ruta)"
[[ -z "$PUB" || "$PUB" == "https://$DOMAIN" ]] || bad "PUBLIC_BASE_URL debe ser https://DOMAIN, sin barra final"
G=$(val GOOGLE_REDIRECT_URL)
[[ -z "$G" || "$G" == "https://$DOMAIN/auth/google/callback" ]] || bad "GOOGLE_REDIRECT_URL debe ser https://DOMAIN/auth/google/callback"
K=$(val PASETO_LOCAL_KEY)
[[ -z "$K" || "$K" =~ ^[0-9a-fA-F]{64}$ ]] || bad "PASETO_LOCAL_KEY debe tener 64 caracteres hex (make gen-key)"
T=$(val SMTP_TLS)
[[ -z "$T" || "$T" == starttls || "$T" == ssl ]] || bad "SMTP_TLS debe ser starttls (o ssl); none es solo para mailpit"
[[ "$(val SMTP_PORT)" != 25 && "$(val SMTP_PORT)" != 465 ]] || bad "SMTP_PORT: Hetzner bloquea 25 y 465; usa 587 con starttls"
F=$(val MAIL_FROM)
[[ -z "$F" || "$F" == *"@$DOMAIN"* ]] || bad "MAIL_FROM no usa @DOMAIN (Resend solo envía desde un dominio verificado)"
P=$(val N8N_OWNER_PASSWORD)
[[ -z "$P" || ${#P} -ge 20 ]] || bad "N8N_OWNER_PASSWORD debe tener al menos 20 caracteres"
[[ "$(val NODE_FORMING_EVENT)" != false ]] || bad "NODE_FORMING_EVENT=false: el frontend actual lo soporta (déjala vacía o true)"

# Valores por defecto de desarrollo, publicados en docker-compose.yml.
for pair in "POSTGRES_PASSWORD:nexo" "N8N_ENCRYPTION_KEY:nexo-dev-change-in-prod" "N8N_OWNER_PASSWORD:N3x0Dev2026!"; do
  [[ "$(val "${pair%%:*}")" != "${pair#*:}" ]] || bad "${pair%%:*} usa el valor de desarrollo del repositorio"
done

# Permisos: el .env lleva todos los secretos.
perm=$(stat -c %a "$ENV_FILE" 2>/dev/null || stat -f %Lp "$ENV_FILE")
[[ "$perm" == 600 || "$perm" == 400 ]] || bad "$ENV_FILE tiene permisos $perm (chmod 600 $ENV_FILE)"

# Respaldos cifrados: la clave pública de age (ver docs/despliegue.md §12).
R="${AGE_RECIPIENTS:-./backup-recipients.txt}"
[[ -r "$R" ]] && grep -q '^age1' "$R" || bad "falta $R con la clave pública age1… (respaldos cifrados)"

if [[ $fail == 0 ]]; then echo "prod-check: OK"; else echo "prod-check: hay errores"; fi
exit $fail
