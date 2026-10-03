# Guía de despliegue — Nexo (producción)

Stack: Docker Compose + Traefik v2.11 en un único VPS (Hetzner).
TLS automático con Let's Encrypt (ACME HTTP-01).

---

## 1. Requisitos previos

### Hardware
Hetzner **CX32** (4 vCPU, 8 GB RAM, 80 GB SSD NVMe) o superior.
Los límites de memoria del stack suman ~2.3 GB; el resto es para el SO y headroom.

### Software en el VPS
- Ubuntu 24.04 LTS
- Docker CE 26+ (ver paso 2)
- Git

### Dominio
Un dominio o subdominio con un registro A apuntando a la IP del VPS
(p. ej. `nexo.kirbith.com → 1.2.3.4`).
**El DNS debe propagarse antes de levantar el stack** — Let's Encrypt lo verifica.

---

## 2. Instalar Docker en el VPS

```bash
# Como root o con sudo
apt-get update
apt-get install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Verificar
docker --version
docker compose version
```

Añadir tu usuario a `docker` si no vas a usar root:
```bash
usermod -aG docker $USER
# Reconectar SSH para que tome efecto
```

---

## 3. Clonar el repo

```bash
cd /opt
git clone https://github.com/<usuario>/nexo.git
cd nexo
```

---

## 4. Configurar el DNS

En el panel de tu registrador, crea:

| Tipo | Nombre | Valor | TTL |
|---|---|---|---|
| A | nexo.kirbith.com | `<IP del VPS>` | 300 |

Verifica que propaga antes de continuar:
```bash
dig +short nexo.kirbith.com
# Debe devolver la IP del VPS
```

---

## 5. Crear el archivo `.env`

```bash
cp .env.example .env
nano .env   # o vim, o el editor que prefieras
```

Rellena TODOS los valores:

| Variable | Servicio | Cómo obtenerla |
|---|---|---|
| `PASETO_LOCAL_KEY` | gateway | `make gen-key` o `python3 -c "import secrets; print(secrets.token_hex(32))"` |
| `DEEPSEEK_API_KEY` | agente | platform.deepseek.com → API keys |
| `DEEPSEEK_MODEL` | agente | `deepseek-chat` (dejar el default) |
| `TELEGRAM_BOT_TOKEN` | agente, n8n | @BotFather → /newbot |
| `TELEGRAM_CHAT_ID` | agente, n8n | Enviar mensaje al bot, luego `https://api.telegram.org/bot<TOKEN>/getUpdates` |
| `POSTGRES_PASSWORD` | postgres, agente | Aleatorio, ≥ 24 chars |
| `N8N_ENCRYPTION_KEY` | n8n | `python3 -c "import secrets; print(secrets.token_hex(32))"` — **guardar en lugar seguro; no cambiar nunca** |
| `N8N_OWNER_PASSWORD` | n8n | Contraseña fuerte para la UI (solo primer arranque) |
| `DOMAIN` | traefik | `nexo.kirbith.com` (sin https://) |
| `ACME_EMAIL` | traefik | Tu email (Let's Encrypt lo usa solo para avisos de caducidad) |

**Permisos del `.env`:**
```bash
chmod 600 .env
```

---

## 6. Preparar `traefik/acme.json`

Traefik guarda los certificados en este archivo. Debe existir con permisos 600
antes del primer arranque, o Traefik rechazará usarlo.

```bash
mkdir -p traefik
touch traefik/acme.json
chmod 600 traefik/acme.json
```

`make prod-up` también hace esto automáticamente en cada arranque.

---

## 7. Validar la configuración antes de levantar

```bash
make prod-config
# Imprime el compose combinado resuelto sin levantar ningún contenedor.
# Si hay errores de sintaxis o variables no resueltas, los verás aquí.
```

---

## 8. Levantar el stack

```bash
make prod-up
```

Esto ejecuta:
1. `mkdir -p traefik && touch traefik/acme.json && chmod 600 traefik/acme.json`
2. `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`

La primera vez, el agente tarda ~2 minutos en arrancar (descarga el modelo de embeddings).
Traefik obtiene el certificado TLS en la primera petición HTTPS al dominio.

---

## 9. Verificar el despliegue

### Contenedores y límites de memoria
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
docker stats --no-stream
```

### Solo 80 y 443 públicos
```bash
# Desde el propio VPS
ss -tlnp | grep -E ':80|:443|:5678|:8888|:8080|:5432|:6379|:8000'
# Solo deben aparecer :80 y :443 escuchando en 0.0.0.0
```

### Endpoints
```bash
# Health check (HTTP → HTTPS redirect: 301)
curl -I http://nexo.kirbith.com/health
# Con HTTPS
curl https://nexo.kirbith.com/health
# {"status":"ok","service":"gateway"}

# Guest token
curl https://nexo.kirbith.com/auth/guest \
  -H "X-Visitor-Id: $(python3 -c 'import uuid; print(uuid.uuid4())')"
# {"token":"v4.local...."}

# Certificado TLS
curl -v https://nexo.kirbith.com/health 2>&1 | grep -E "subject|expire|issuer"
```

### Frontend
Abre `https://nexo.kirbith.com` en el navegador. El portafolio debe cargar sin
errores de TLS ni de consola.

---

## 10. Acceder a la UI de n8n en producción

El puerto 5678 **no está publicado al exterior**. Para acceder, abre un túnel SSH:

```bash
# En tu máquina local:
ssh -L 5678:localhost:5678 root@<IP-del-VPS> -N
# En otro terminal, abre: http://localhost:5678
```

Las credenciales son `owner@nexo.local` y el valor de `N8N_OWNER_PASSWORD` de tu `.env`.

---

## 11. Configurar backups automáticos (cron)

```bash
crontab -e
# Añadir:
0 3 * * * cd /opt/nexo && make backup >> /var/log/nexo-backup.log 2>&1
```

Los backups se guardan en `/opt/nexo/backups/` con 30 días de retención:
- `nexo_db_YYYYMMDD_HHMMSS.sql.gz` — pg_dump completo
- `n8n_workflows_YYYYMMDD_HHMMSS.json` — export de workflows

Para restaurar la base de datos:
```bash
zcat backups/nexo_db_<fecha>.sql.gz | docker compose exec -T postgres psql -U nexo nexo
```

---

## 12. Actualizar el stack

```bash
cd /opt/nexo
git pull
make prod-up   # rebuild + restart solo los contenedores con cambios
```

---

## 13. Apagar y limpiar

```bash
# Solo bajar los contenedores (los volúmenes persisten)
make prod-down

# Bajar y borrar volúmenes (¡irreversible! hacer backup primero)
docker compose -f docker-compose.yml -f docker-compose.prod.yml down -v
```

---

## Troubleshooting rápido

| Síntoma | Qué revisar |
|---|---|
| `make prod-up` falla con "variable not set" | Alguna variable falta en `.env` — revisar `.env.example` |
| Traefik no obtiene el cert | DNS no propagado; puerto 80 bloqueado por firewall del VPS |
| Agente no arranca | `docker logs nexo-agent-1 --tail 50` — verificar `DEEPSEEK_API_KEY` y `POSTGRES_URL` |
| n8n workflows no activos | `docker logs nexo-n8n-1 --tail 80` — revisar `N8N_ENCRYPTION_KEY` |
| `acme.json` permission error | `chmod 600 traefik/acme.json` y reiniciar Traefik |
