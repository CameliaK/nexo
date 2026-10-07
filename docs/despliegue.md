# Guía de despliegue — Nexo (producción)

Stack: Docker Compose + Traefik v2.11 en un único VPS (Hetzner).
TLS automático con Let's Encrypt (ACME HTTP-01).

---

## 1. Requisitos previos

### Hardware
Hetzner **CX32** (4 vCPU, 8 GB RAM, 80 GB SSD NVMe) o superior.
Los límites de memoria del stack suman ~3.6 GB. El agente, con PyTorch y el modelo de
embeddings multilingüe, usa ~1.06 GiB en reposo y llega a ~1.22 GiB con carga; su límite es
2048 MB. El resto es para el SO y margen.

### Software en el VPS
- Ubuntu 24.04 LTS
- Docker CE 26+ (ver paso 2)
- Git

### Dominio
Un dominio o subdominio con un registro A apuntando a la IP del VPS
(p. ej. `nexo.kirbith.com → 1.2.3.4`).
**El DNS debe propagarse antes de levantar el stack** — Let's Encrypt lo verifica.

---

## 2. Endurecer el VPS (antes de instalar nada)

Hazlo en este orden y **sin cerrar la sesión SSH actual** hasta comprobar que la nueva
funciona: si un paso falla te quedas fuera del servidor.

### 2.1 Usuario sin privilegios de root

```bash
# Como root, recién creado el VPS (Hetzner te deja entrar con tu llave SSH)
adduser deploy                       # pide una contraseña: solo se usará para sudo
usermod -aG sudo deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
install -m 600 -o deploy -g deploy /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
```

Prueba en **otra terminal**: `ssh deploy@<IP-del-VPS>` y `sudo -v`. A partir de aquí todo
se hace como `deploy`.

> Pertenecer al grupo `docker` (paso 3) equivale a ser root en la máquina. Solo `deploy`
> debe estar en él.

### 2.2 SSH solo con llave

```bash
sudo tee /etc/ssh/sshd_config.d/99-nexo.conf >/dev/null <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AllowUsers deploy
EOF
sudo sshd -t && sudo systemctl reload ssh
```

Comprueba desde otra terminal que `ssh deploy@<IP>` entra y que `ssh root@<IP>` es
rechazado antes de cerrar la sesión original.

### 2.3 Firewall

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

**Importante:** Docker publica puertos escribiendo sus propias reglas de iptables, **por
delante de ufw**. Un `ports:` en un servicio queda abierto a Internet aunque ufw diga lo
contrario. Por eso:
- en producción solo Traefik publica puertos (80 y 443); n8n, Postgres, Redis, el agente
  y el dashboard de Traefik no publican nada;
- `docker-compose.override.yml` (puertos de depuración y mailpit) **nunca** se usa en el
  VPS: usa siempre `make prod-*`, que pasa los `-f` explícitos;
- como segunda capa, crea en Hetzner un *Cloud Firewall* con solo 22, 80 y 443 entrantes
  y asígnalo al servidor.

### 2.4 Actualizaciones automáticas de seguridad

```bash
sudo apt-get install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades     # responder "Yes"
sudo tee /etc/apt/apt.conf.d/52nexo-reboot >/dev/null <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
EOF
```

El reinicio automático (solo cuando un parche lo exige) es seguro: Docker arranca con el
sistema y todos los servicios tienen `restart: unless-stopped`. Queda después del respaldo
de las 03:00.

Opcional: `sudo apt-get install -y fail2ban` (la jaula `sshd` viene activa por defecto).

---

## 3. Instalar Docker en el VPS

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

Añadir `deploy` al grupo `docker` (equivale a root; ver 2.1):
```bash
sudo usermod -aG docker deploy
# Reconectar SSH para que tome efecto
```

---

## 4. Clonar el repo

```bash
sudo install -d -o deploy -g deploy /opt/nexo
git clone https://github.com/<usuario>/nexo.git /opt/nexo
cd /opt/nexo
```

---

## 5. Configurar el DNS

En el panel de tu registrador, crea:

| Tipo | Nombre | Valor | TTL |
|---|---|---|---|
| A | nexo.kirbith.com | `<IP del VPS>` | 300 |
| A | www.nexo.kirbith.com | `<IP del VPS>` | 300 |

Verifica que propaga antes de continuar:
```bash
dig +short nexo.kirbith.com
# Debe devolver la IP del VPS
```

---

## 6. Crear el archivo `.env`

```bash
cp .env.prod.example .env
chmod 600 .env
nano .env   # o el editor que prefieras
```

`.env.prod.example` lista **todas** las variables, qué servicio usa cada una y sus valores
por defecto. Las marcadas *obligatoria* las exige `docker-compose.prod.yml`: si falta
alguna, `make prod-config` falla en vez de arrancar con un valor de desarrollo.

| Variable | Cómo obtenerla |
|---|---|
| `PASETO_LOCAL_KEY` | `make gen-key` o `python3 -c "import secrets; print(secrets.token_hex(32))"` |
| `POSTGRES_PASSWORD` | Aleatoria, ≥ 24 caracteres |
| `N8N_ENCRYPTION_KEY` | `python3 -c "import secrets; print(secrets.token_hex(32))"` — **guárdala; no la cambies nunca** |
| `N8N_OWNER_PASSWORD` | Contraseña fuerte para la UI (solo primer arranque) |
| `DEEPSEEK_API_KEY` | platform.deepseek.com → API keys |
| `TELEGRAM_BOT_TOKEN` | @BotFather → /newbot |
| `TELEGRAM_CHAT_ID` | Escribe al bot y consulta `getUpdates` (ver abajo) |
| `DOMAIN`, `ACME_EMAIL`, `PUBLIC_BASE_URL` | Tu dominio, tu correo y `https://<dominio>` |

> **No reutilices** los valores por defecto de desarrollo que aparecen en
> `docker-compose.yml` (`nexo-dev-change-in-prod`, `N3x0Dev2026!`, `nexo`): están
> publicados en el repositorio.

Para el chat id, sin dejar el token en el historial de la shell:
```bash
read -rs TOKEN && curl -s "https://api.telegram.org/bot${TOKEN}/getUpdates" | grep -o '"chat":{"id":[-0-9]*'; unset TOKEN
```

---

## 7. Certificados TLS

No hay nada que preparar: Traefik guarda los certificados de Let's Encrypt en el volumen
`traefik_acme` (antes era un archivo `traefik/acme.json` montado; si ese archivo no existía,
Docker creaba un *directorio* con ese nombre y ACME fallaba).

Se piden certificados para `DOMAIN` y `www.DOMAIN` (este último solo redirige a la raíz).
Crea también el registro DNS de `www` (paso 5) o Let's Encrypt fallará para él.

Si migras un despliegue anterior que ya tenía `traefik/acme.json`:
```bash
docker volume create nexo_traefik_acme
docker run --rm -v nexo_traefik_acme:/letsencrypt -v "$PWD/traefik:/old:ro" alpine \
  sh -c 'cp /old/acme.json /letsencrypt/acme.json && chmod 600 /letsencrypt/acme.json'
```

---

## 8. Validar la configuración antes de levantar

```bash
make prod-config
# Valida el compose combinado (sintaxis y variables obligatorias) sin levantar nada.
# No imprime la configuración: `docker compose … config` a secas muestra los secretos.
```

---

## 9. Levantar el stack

```bash
make prod-up
```

Esto ejecuta:
1. `make prod-config` (falla si falta una variable obligatoria)
2. `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`

La primera vez, el agente tarda ~2 minutos en arrancar (descarga el modelo de embeddings).
Traefik obtiene el certificado TLS en la primera petición HTTPS al dominio.

---

## 10. Verificar el despliegue

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

# Cabeceras de seguridad (HSTS, nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy)
curl -sI https://nexo.kirbith.com/ | grep -iE "strict-transport|x-content-type|x-frame|referrer|permissions"

# www → raíz (301)
curl -sI https://www.nexo.kirbith.com/algo | grep -iE "^HTTP|^location"
```

### Puertos vistos desde fuera
Desde **tu máquina** (no desde el VPS, porque ahí todo es local):
```bash
nmap -Pn -p 22,80,443,5432,5678,6379,8000,8080,8888 <IP-del-VPS>
# Solo 22, 80 y 443 deben aparecer "open".
```

### Todos los servicios sanos
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
# Cada servicio debe decir (healthy): todos tienen healthcheck.
```

### Frontend
Abre `https://nexo.kirbith.com` en el navegador. El portafolio debe cargar sin
errores de TLS ni de consola.

---

## 11. Acceder a la UI de n8n en producción

El puerto 5678 **no está publicado al exterior**. Para acceder, abre un túnel SSH:

```bash
# En tu máquina local:
ssh -L 5678:localhost:5678 deploy@<IP-del-VPS> -N
# En otro terminal, abre: http://localhost:5678
```

Las credenciales son `owner@nexo.local` y el valor de `N8N_OWNER_PASSWORD` de tu `.env`.

---

## 12. Respaldos automáticos (cron)

`make backup-prod` hace un `pg_dump` comprimido (con `--clean`, restaurable sobre una base
existente) y exporta los workflows de n8n. Los archivos se crean con permisos 600 porque
**contienen datos personales** (correos de las cuentas, mensajes del chat en vivo). Se
borran a los 30 días.

```bash
sudo install -d -o deploy -g deploy -m 700 /opt/nexo/backups
crontab -e      # como deploy
# Añadir (03:00, antes del posible reinicio de las 04:30):
0 3 * * * cd /opt/nexo && BACKUP_DIR=/opt/nexo/backups make backup-prod >> /opt/nexo/backups/backup.log 2>&1
```

Comprueba al día siguiente: `tail /opt/nexo/backups/backup.log` y `ls -l /opt/nexo/backups`.

**Copia fuera del VPS.** Un respaldo en el mismo disco no sobrevive a la pérdida del
servidor. Cópialo cifrado a otro sitio, por ejemplo a un Hetzner Storage Box con `restic`
o con `rsync` a una máquina tuya.

**Privacidad.** Lo que un visitante borra (`DELETE /api/v1/session/data`, borrar la cuenta)
o lo que caduca por retención sigue en los respaldos hasta 30 días. Si restauras uno, los
datos borrados después de esa fecha vuelven: tras restaurar, el barrido de retención los
vuelve a borrar si ya caducaron, pero un borrado explícito hay que repetirlo.

### Probar un respaldo (en una base temporal, sin tocar la real)

```bash
DUMP=$(ls -t backups/nexo_db_*.sql.gz | head -1)
C="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
$C exec -T postgres psql -U nexo -d postgres -c "CREATE DATABASE nexo_restore_test"
gunzip -c "$DUMP" | $C exec -T postgres psql -U nexo -d nexo_restore_test -q -v ON_ERROR_STOP=1
$C exec -T postgres psql -U nexo -d nexo_restore_test -c "SELECT count(*) FROM accounts"
$C exec -T postgres psql -U nexo -d postgres -c "DROP DATABASE nexo_restore_test"
```

Probado el 2026-10-05: tablas, filas, índices y búsqueda vectorial idénticos a la original.

### Restaurar de verdad

```bash
C="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
$C stop gateway agent n8n                 # nadie escribe mientras tanto
gunzip -c backups/nexo_db_<fecha>.sql.gz | $C exec -T postgres psql -U nexo -d nexo -q -v ON_ERROR_STOP=1
$C start agent gateway n8n
```

### Registros (logs) y direcciones IP

Revisado el 2026-10-07. Rotación de Docker por tamaño (`x-logging` en `docker-compose.yml`):
3 archivos de 10 MB por contenedor; `docker compose down` / recrear un contenedor borra sus
logs.

| Servicio | ¿IP del visitante en el log? | Qué registra | Volumen medido (sin tráfico) → 30 MB |
|---|---|---|---|
| traefik | No: sin registro de acceso (nunca añadir `--accesslog`) | Solo errores | ~0 |
| web-nexo (nginx) | No: `$remote_addr` es la IP del contenedor de Traefik (no hay `real_ip`), y sin query ni Referer | Una línea por petición; el healthcheck pide `/index.html` cada 30 s | ~0,2 MB/día → ~4 meses; menos con visitas |
| gateway | No: ninguna línea lleva IP; ids enmascarados (8 caracteres) | Arranque, ws open/close, errores | Casi nada en reposo |
| agent (uvicorn) | No: el cliente siempre era el contenedor del gateway/n8n o 127.0.0.1; desde ahora se sustituye por `-` y se quita el query | Healthcheck cada 15 s, sondeo de Telegram cada 30 s | ~0,56 MB/día → ~7 semanas |
| n8n | No: no recibe tráfico público (los webhooks vienen del agente) | Arranque y activación de flujos | Casi nada |

Fuera de los logs:
- **Redis**: los contadores de límite por IP (`rl:*:ip:…`, ventana de 1 h) guardaban la IP en
  claro, también en el `dump.rdb` del volumen. Ahora la clave es un HMAC-SHA256 de la IP
  (truncado, con una clave aleatoria por proceso del gateway): Redis nunca ve la dirección.
  Un reinicio del gateway reinicia esas ventanas.
- **Postgres**: ninguna tabla guarda IPs.
- **Ejecuciones de n8n** con error (7 días): cuerpo del webhook del agente, sin IPs.

---

## 13. Actualizar

### El código del stack

```bash
cd /opt/nexo
df -h /                     # si quedan < 10 GB libres, libera espacio antes de construir
make backup-prod            # respaldo justo antes
git fetch && git log --oneline HEAD..origin/main     # qué entra
git diff HEAD..origin/main -- .env.prod.example      # ¿variables nuevas?
git pull
make prod-up                # valida, construye con caché y recrea solo lo que cambió
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --since 10m | grep -iE "error|panic|traceback"
```

Si algo falla, vuelve al commit anterior: `git checkout <commit-anterior> && make prod-up`.
Las migraciones del gateway solo avanzan; si una ya se aplicó, restaura el respaldo (§12).

No uses `--no-cache` salvo que cambie un Dockerfile o las dependencias: la imagen del agente
pesa varios GB y llenar el disco tumba Docker.

### Las imágenes de terceros

Traefik (`v2.11`), Redis (`7-alpine`) y Postgres (`pgvector:pg17`) siguen su rama de
parches; n8n está fijado a una versión exacta. Para traer parches:
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull traefik redis postgres
make prod-up
```
Subir n8n de versión es un cambio de código: cambia la etiqueta en `docker-compose.yml`,
pruébalo en desarrollo (Code nodes en vm2, ver CLAUDE.md) y despliega.

### El sistema

Los parches de seguridad se instalan solos (2.4). Para el resto, de vez en cuando:
`sudo apt-get update && sudo apt-get upgrade`.

---

## 14. Apagar y limpiar

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
| Traefik no obtiene el cert | DNS no propagado; puerto 80 bloqueado por firewall del VPS |
| Agente no arranca | `docker logs nexo-agent-1 --tail 50` — verificar `DEEPSEEK_API_KEY` y `POSTGRES_URL` |
| n8n workflows no activos | `docker logs nexo-n8n-1 --tail 80` — revisar `N8N_ENCRYPTION_KEY` |
| Traefik no obtiene el cert de `www` | Falta el registro DNS de `www.DOMAIN` |
| `make prod-config` falla con "required variable … is missing" | Falta una variable obligatoria en `.env` — ver `.env.prod.example` |
