# Guía de despliegue — Nexo (producción)

Stack: Docker Compose + Traefik v2.11 en un único VPS (Hetzner Cloud, Ashburn).
TLS automático con Let's Encrypt (ACME HTTP-01). Dominio: `kirbith.dev` (DNS en Cloudflare,
"solo DNS"). Correo: Resend.

Orden: crear el servidor (1.1) → endurecerlo (2) → Docker (3) → repo (4) → DNS (5) → `.env`
y correo (6) → respaldos (12.1–12.2) → `make prod-check` y `make prod-up` (8–9) → lista de
comprobación (10.1).

---

## 1. Requisitos previos

### Hardware
Hetzner Cloud en **Ashburn (ash)**: 4 vCPU, 8 GB de RAM, ~160 GB de disco.

Límites de memoria (`docker-compose.prod.yml`, recalculados el 2026-10-07):

| Servicio | Límite | Medido (dev) |
|---|---|---|
| agent | 2048 MiB | 1,37 GiB tras arrancar y generar un nodo |
| traefik | 256 MiB | 158 MiB |
| postgres | 512 MiB | 21 MiB |
| n8n | 512 MiB | 228 MiB |
| redis | 128 MiB | 15 MiB |
| gateway | 64 MiB | 13 MiB |
| web-nexo | 64 MiB | 9 MiB |
| **Total** | **3584 MiB (3,5 GiB)** | ≈ 1,9 GiB |

Linux ve ~7,6 GiB de un servidor "8 GB"; Ubuntu + Docker ≈ 1 GiB con holgura. **Margen en
el peor caso (todos los contenedores en su límite a la vez): ~3,1 GiB**; en uso normal quedan
~4,5 GiB para la caché de disco. No es justo, así que el swap es opcional (§2.5): solo
amortigua picos como una construcción de la imagen del agente en el servidor.

### Software en el VPS
- Ubuntu 24.04 LTS
- Docker CE (paso 3), Git, age (respaldos)

### Dominio
`kirbith.dev` y `www.kirbith.dev` apuntando a la IP del VPS (paso 5).
**El DNS debe propagarse antes de levantar el stack** — Let's Encrypt lo verifica.

### 1.1 Crear el servidor en Hetzner Cloud

En console.hetzner.cloud → tu proyecto:

1. **Security → SSH keys → Add SSH key**: pega tu llave pública
   (`cat ~/.ssh/id_ed25519.pub`; si no tienes, `ssh-keygen -t ed25519`).
2. **Firewalls → Create Firewall** `nexo-fw`. Reglas entrantes, origen *Any IPv4* y *Any
   IPv6*: TCP 22, TCP 80, TCP 443 (y ICMP si quieres `ping`). Sin reglas salientes = toda la
   salida permitida (la necesitan Let's Encrypt, PyPI, Telegram, DeepSeek y Resend por el
   587). Este firewall actúa fuera del servidor, así que Docker no puede saltárselo (ver 2.3).
3. **Servers → Add Server**: ubicación **Ashburn, VA (ash)**; imagen **Ubuntu 24.04**; tipo
   de 4 vCPU / 8 GB / ~160 GB; IPv4 + IPv6 públicas; **SSH key**: la del paso 1 (así no se
   crea contraseña de root); **Firewalls**: `nexo-fw`; nombre `nexo`.
4. Anota la IPv4 (y la IPv6). Primera entrada: `ssh root@<IP>`.

Opcional: activar los *Backups* de Hetzner (copia del disco entero, aparte de los respaldos
cifrados de la base del §12).

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
- la capa que Docker no puede saltarse es el *Cloud Firewall* de Hetzner (1.1, solo 22, 80
  y 443 entrantes); ufw queda como segunda capa para SSH y lo que no sea Docker.

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

### 2.5 Swap pequeño (opcional)

Las imágenes de Hetzner Cloud no traen swap. Con ~3 GiB de margen no hace falta para el
stack, pero 2 GiB de swap con `swappiness` baja evitan que el OOM killer mate algo durante
un pico (un `docker build` del agente en el servidor, un `apt upgrade` grande):

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-nexo-swap.conf && sudo sysctl --system
free -h
```

---

## 3. Instalar Docker en el VPS

```bash
# Como deploy (con sudo)
sudo apt-get update
sudo apt-get install -y ca-certificates curl git make age
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

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

Si el repositorio es privado, crea en el VPS una llave solo para él
(`ssh-keygen -t ed25519 -f ~/.ssh/nexo_deploy -N ''`), añádela en GitHub como *Deploy key*
de solo lectura y clona por SSH
(`GIT_SSH_COMMAND='ssh -i ~/.ssh/nexo_deploy' git clone git@github.com:<usuario>/nexo.git /opt/nexo`,
luego `git config core.sshCommand 'ssh -i ~/.ssh/nexo_deploy'` dentro del repo).

---

## 5. Configurar el DNS (Cloudflare, "solo DNS")

En Cloudflare → `kirbith.dev` → DNS → Records:

| Tipo | Nombre | Contenido | Proxy | TTL |
|---|---|---|---|---|
| A | `kirbith.dev` (`@`) | IPv4 del VPS | **DNS only** (nube gris) | Auto |
| A | `www` | IPv4 del VPS | **DNS only** | Auto |
| AAAA | `@` y `www` (opcional) | IPv6 del VPS | **DNS only** | Auto |
| TXT / MX / CNAME | los que indique Resend al verificar el dominio (SPF, DKIM, rebotes) | — | **DNS only** | Auto |

Por qué **solo DNS** y no el proxy naranja:
- Traefik debe ver la IP real del visitante: los límites por IP del gateway confían solo en
  Traefik (`TRUSTED_PROXIES=traefik`). Con el proxy, todas las visitas parecerían venir de
  unas pocas IPs de Cloudflare y compartirían el límite.
- Let's Encrypt valida por HTTP-01 contra el propio servidor, y el certificado lo sirve
  Traefik de extremo a extremo; el WebSocket va directo.
- Si algún día activas el proxy: añade los rangos de Cloudflare a
  `--entrypoints.websecure.forwardedHeaders.trustedIPs` y a `TRUSTED_PROXIES`, y pon el modo
  SSL en *Full (strict)*.

Opcional (recomendado): un registro **CAA** `@` → `0 issue "letsencrypt.org"`.

Verifica que propaga antes de continuar:
```bash
dig +short kirbith.dev www.kirbith.dev     # la IP del VPS, dos veces (no IPs de Cloudflare)
```

---

## 6. Crear el archivo `.env`

```bash
cp .env.prod.example .env
chmod 600 .env
nano .env   # o el editor que prefieras
```

`.env.prod.example` lista **todas** las variables, qué servicio usa cada una y sus valores
por defecto, y ya trae los valores no secretos de producción (`DOMAIN=kirbith.dev`,
`PUBLIC_BASE_URL`, `GOOGLE_REDIRECT_URL`, Resend, `MAIL_FROM`). Las marcadas *obligatoria*
las comprueba `make prod-check` (§8), que no imprime valores.

| Variable | Cómo obtenerla |
|---|---|
| `PASETO_LOCAL_KEY` | `make gen-key` o `python3 -c "import secrets; print(secrets.token_hex(32))"` |
| `POSTGRES_PASSWORD` | Aleatoria, ≥ 24 caracteres |
| `N8N_ENCRYPTION_KEY` | `python3 -c "import secrets; print(secrets.token_hex(32))"` — **guárdala; no la cambies nunca** |
| `N8N_OWNER_PASSWORD` | Contraseña fuerte para la UI (solo primer arranque) |
| `DEEPSEEK_API_KEY` | platform.deepseek.com → API keys |
| `TELEGRAM_BOT_TOKEN` | @BotFather → /newbot |
| `TELEGRAM_CHAT_ID` | Escribe al bot y consulta `getUpdates` (ver abajo) |
| `ACME_EMAIL` | Tu correo (avisos de caducidad de Let's Encrypt) |
| `OWNER_EMAIL` | Tu correo de Google: es el que concede el modo dueño |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud Console → APIs & Services → Credentials → OAuth client ID (*Web application*). *Authorized redirect URI*: `https://kirbith.dev/auth/google/callback` (exacto, igual que `GOOGLE_REDIRECT_URL`). Pantalla de consentimiento en modo *In production* (o tu correo como usuario de prueba) |
| `SMTP_PASS` | API key de Resend (§6.1) |

> **No reutilices** los valores por defecto de desarrollo que aparecen en
> `docker-compose.yml` (`nexo-dev-change-in-prod`, `N3x0Dev2026!`, `nexo`): están
> publicados en el repositorio.

Para el chat id, sin dejar el token en el historial de la shell:
```bash
read -rs TOKEN && curl -s "https://api.telegram.org/bot${TOKEN}/getUpdates" | grep -o '"chat":{"id":[-0-9]*'; unset TOKEN
```

---

## 6.1 Correo (Resend)

El gateway envía los enlaces de inicio de sesión y los avisos de ajedrez por SMTP:

| Variable | Valor |
|---|---|
| `SMTP_HOST` | `smtp.resend.com` |
| `SMTP_PORT` | `587` |
| `SMTP_TLS` | `starttls` (obligatorio, ver abajo) |
| `SMTP_USER` | `resend` (literal) |
| `SMTP_PASS` | la API key de Resend (permiso *Sending access* basta) |
| `MAIL_FROM` | `Nexo <no-reply@kirbith.dev>` |

- **Puerto 587.** Hetzner bloquea por defecto la salida por los puertos 25 y 465 en
  servidores nuevos; el 587 con STARTTLS no está bloqueado. No uses `SMTP_TLS=ssl` (465).
- **TLS sin caída a texto plano.** Con `starttls` el gateway usa la política `TLSMandatory`
  de go-mail v0.8.1: si el servidor no anuncia STARTTLS, el handshake falla o el certificado no
  valida (TLS ≥ 1.2, nombre `smtp.resend.com`), el envío falla y no se manda nada. `none`
  solo existe para mailpit y se rechaza al arrancar si hay usuario o contraseña.
  Comprobado: contra un servidor sin STARTTLS → `target host does not support STARTTLS`;
  `smtp.resend.com:587` anuncia STARTTLS y su certificado valida con el almacén de Alpine
  (el de la imagen del gateway).
- **Dominio en Resend.** Verifica `kirbith.dev` en Resend (registros SPF/DKIM que te da, en
  Cloudflare como "solo DNS") antes de la prueba; si no, Resend rechaza el remitente.

Prueba con el `.env` del servidor (con el stack levantado; tras editar `.env`, `make prod-up`):

```bash
make mail-test TO=tu-correo@ejemplo.com     # o sin TO: MAIL_TEST_TO u OWNER_EMAIL
# mail-test: host=smtp.resend.com port=587 tls=starttls auth=true from="Nexo <no-reply@kirbith.dev>" to=t***@ejemplo.com
# mail-test: sent OK — check the inbox (and spam)
```

No imprime la contraseña. Si falla, el mensaje de go-mail dice en qué paso (conexión,
STARTTLS, autenticación o remitente).

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
make prod-check
# Obligatorias (las ${VAR:?} de docker-compose.prod.yml + correo, Google y dueño), formatos
# (DOMAIN, PUBLIC_BASE_URL, GOOGLE_REDIRECT_URL, PASETO, SMTP), valores de desarrollo del
# repo, permisos 600 del .env y la clave pública de age. Solo imprime nombres, nunca valores.
make prod-config
# Valida el compose combinado (sintaxis) sin levantar nada ni imprimirlo
# (`docker compose … config` a secas muestra los secretos).
```

---

## 8.1 Dónde se construyen las imágenes

**Decisión: se construyen en el VPS** (`make prod-up` = `up -d --build`). Es lo más simple:

| | Construir en el VPS | Registro privado desde la Mac |
|---|---|---|
| Arquitectura | amd64 nativo | La Mac es arm64: `buildx --platform linux/amd64` con emulación QEMU (pip y torch emulados, lento) |
| Subida | Nada: el VPS descarga de PyPI/PyTorch/Hugging Face desde el centro de datos | ~2,9 GB del agente desde tu conexión de casa en cada cambio de dependencias |
| Piezas nuevas | Ninguna | Cuenta y token del registro en el VPS (`docker login`), etiquetas por versión, y un `image:` por servicio en el compose de producción |
| Costo | 0 | Los planes gratuitos limitan el almacenamiento privado; una imagen de 2,9 GB puede no caber |
| Riesgo | Un build usa CPU/RAM del servidor unos minutos (el swap de §2.5 lo amortigua) | Si el registro no responde, no hay despliegue |

Reproducibilidad: `requirements.txt`, `go.mod`, n8n y el modelo de embeddings ya estaban
fijados; `torch` se fijó a `2.14.1` (CPU) en `ai-python/Dockerfile`, la versión probada, para
que el VPS no construya con otra.

Tiempos de referencia (Mac, red de casa, 2026-10-07): la capa de torch tardó ~1 min, las
dependencias ~7 min, el modelo ~1,5 min. Un cambio solo de código (`app/`) reutiliza todas las
capas y tarda segundos; solo un cambio del Dockerfile o de `requirements.txt` vuelve a
descargar todo.

**Disco en el VPS (~160 GB):**

| Qué | Tamaño aproximado |
|---|---|
| Imágenes: agent 2,9 GB, n8n 1,8, pgvector 0,65, traefik 0,23, gateway/web/redis 0,2 | ~5,8 GB |
| Imágenes base de los builds (python slim, golang alpine, node alpine) | ~0,8 GB |
| Caché de BuildKit | ~4–5 GB (medido 4,7 GB en la Mac) |
| Volúmenes (Postgres, n8n, Redis, certificados) | < 1 GB hoy |
| Logs (3 × 10 MB × 8 contenedores) | ≤ 0,25 GB |
| Respaldos cifrados (30 días) | < 10 MB hoy |
| **Total** | **~12–13 GB**, < 10 % del disco |

Cada reconstrucción que cambia dependencias deja la imagen anterior del agente "colgando"
(~2,9 GB, `<none>` en `docker images`). Con 160 GB caben muchas, pero tras confirmar que el
despliegue nuevo funciona puedes liberarlas con `docker image prune -f`: borra **solo** imágenes
sin etiqueta y sin contenedor; no toca volúmenes ni la caché. Nunca uses
`docker system prune --volumes` ni `down -v` en el servidor.

Cuándo pasar a un registro: si el VPS se queda corto de CPU/RAM para construir, o si algún día
hay más de un servidor. Entonces: `docker buildx build --platform linux/amd64 -t
<registro>/nexo-agent:<commit> --push ai-python` desde la Mac y un `image:` en
`docker-compose.prod.yml`.

---

## 9. Levantar el stack

```bash
make prod-up
```

Esto ejecuta:
1. `make prod-config` (falla si falta una variable obligatoria)
2. `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`

La primera vez construye las imágenes (unos minutos; el agente es el más lento) y el agente
tarda ~1–2 minutos en quedar *healthy* (carga el modelo, que ya viene dentro de la imagen).
Traefik pide los certificados de `kirbith.dev` y `www.kirbith.dev` al arrancar; si fallan,
mira `docker logs nexo-traefik-1` (DNS o puerto 80).

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
curl -I http://kirbith.dev/health
# Con HTTPS
curl https://kirbith.dev/health
# {"status":"ok","service":"gateway"}

# Guest token
curl https://kirbith.dev/auth/guest \
  -H "X-Visitor-Id: $(python3 -c 'import uuid; print(uuid.uuid4())')"
# {"token":"v4.local...."}

# Certificado TLS
curl -v https://kirbith.dev/health 2>&1 | grep -E "subject|expire|issuer"

# Cabeceras de seguridad (HSTS, nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy,
# CSP en Report-Only solo en el frontend)
curl -sI https://kirbith.dev/ | grep -iE "strict-transport|x-content-type|x-frame|referrer|permissions|content-security"

# www → raíz (301)
curl -sI https://www.kirbith.dev/algo | grep -iE "^HTTP|^location"
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
Abre `https://kirbith.dev` en el navegador. El portafolio debe cargar sin
errores de TLS ni de consola.

### 10.1 Lista de comprobación tras el primer despliegue

Marca cada punto desde **tu Mac** (salvo que diga VPS), contra el dominio real.

**HTTPS y certificados**
- [ ] `curl -sI https://kirbith.dev/ | head -1` → `HTTP/2 200`.
- [ ] Emisor Let's Encrypt, nombre correcto y caducidad a ~90 días, para los dos nombres:
  ```bash
  for h in kirbith.dev www.kirbith.dev; do echo | openssl s_client -connect $h:443 -servername $h 2>/dev/null \
    | openssl x509 -noout -issuer -subject -ext subjectAltName -enddate; done
  ```
- [ ] El certificado persiste: `docker compose -f docker-compose.yml -f docker-compose.prod.yml restart traefik`
  en el VPS y repite (sin nuevas peticiones a Let's Encrypt en `docker logs nexo-traefik-1`).

**Redirecciones** (todas 301 y conservando la ruta)
- [ ] `curl -sI http://kirbith.dev/privacidad` → `Location: https://kirbith.dev/privacidad`
- [ ] `curl -sI http://www.kirbith.dev/x` → `https://www.kirbith.dev/x`, y
  `curl -sI https://www.kirbith.dev/x` → `Location: https://kirbith.dev/x`
- [ ] `curl -s https://kirbith.dev/privacidad | grep -o '<title>[^<]*'` → el aviso de privacidad
  (lo sirve nginx, no el gateway).

**Cabeceras**
- [ ] `curl -sI https://kirbith.dev/` trae `strict-transport-security: max-age=31536000; includeSubDomains`,
  `x-content-type-options: nosniff`, `x-frame-options: DENY`, `referrer-policy`,
  `permissions-policy` y `content-security-policy-report-only` con `connect-src 'self' wss://kirbith.dev`;
  **no** trae `server:`.
- [ ] `curl -sI https://kirbith.dev/health` trae HSTS y no trae CSP (es el gateway).
- [ ] En el navegador (DevTools → Console) recorre el sitio: ningún aviso
  `[Report Only] Refused to …`. Si aparece alguno, anótalo antes de pensar en imponer la CSP.

**Puertos**
- [ ] `nmap -Pn -p 22,80,443,5432,5678,6379,8000,8080,8888 <IP>` → solo 22, 80 y 443 `open`.
- [ ] `ssh root@<IP>` es rechazado; `ssh deploy@<IP>` entra solo con llave.

**Un mensaje de cada tipo desde https://kirbith.dev** (con la "ventana al sistema" abierta:
cada uno debe iluminar su recorrido)
- [ ] Pregunta de ruta rápida (p. ej. "¿Qué hizo en Infosys?") → `run.done` con `route`, la
  cámara viaja por los nodos.
- [ ] Pregunta que genera nodo (p. ej. "Crea un nodo sobre su experiencia con Python") →
  el nodo se forma desde sus fuentes (`node.forming`) y nace (`node.spawn`); pasa por n8n.
- [ ] Pregunta fuera de alcance (p. ej. "¿Cuál es la capital de Mongolia?") → `unknown`, sin
  inventar.
- [ ] Chat en vivo: un mensaje del visitante llega a tu Telegram con su etiqueta (`delivered`).
- [ ] Responde en Telegram (función *responder*) → la burbuja aparece en el sitio
  (`live_in`) sin que el visitante haga nada, y la arquitectura se ilumina sin mover la cámara.
- [ ] `/ws?token=…` ya no funciona: el navegador abre `wss://kirbith.dev/ws?ticket=…`
  (DevTools → Network → WS).
- [ ] Límites: más de 20 preguntas en una hora desde el mismo visitante → `429` con
  `Retry-After`.

**Correo real**
- [ ] VPS: `make mail-test TO=<tu correo>` → `sent OK`, y el correo llega (revisa spam) con
  remitente `no-reply@kirbith.dev` y SPF/DKIM `pass` (Gmail → *Mostrar original*).
- [ ] En el sitio, entra con tu correo: llega el enlace, abre `https://kirbith.dev/…` y la
  sesión queda iniciada.

**Inicio de sesión con Google**
- [ ] Entrar con Google redirige a `accounts.google.com` y vuelve a
  `https://kirbith.dev/auth/google/callback` sin `redirect_uri_mismatch`.
- [ ] Con el correo de `OWNER_EMAIL` la cuenta queda en modo dueño (panel del dueño visible);
  con otra cuenta de Google, modo usuario.
- [ ] Cerrar sesión invalida el token (otra pestaña deja de ver el modo dueño al reconectar).

**Respaldo y restauración**
- [ ] VPS: `BACKUP_DIR=/opt/nexo/backups make backup-prod` → dos archivos `.age`, permisos 600;
  `head -c 21 …sql.gz.age` → `age-encryption.org/v1`.
- [ ] Mac: `rsync` de §12.3 los trae; `make restore-test FILE=~/nexo-backups/nexo_db_<fecha>.sql.gz.age`
  lista las tablas con filas (`accounts`, `live_messages`, `rag_fragments`…).
- [ ] Al día siguiente: `tail /opt/nexo/backups/backup.log` muestra el respaldo de las 03:00.

**Salud y logs**
- [ ] `docker compose -f docker-compose.yml -f docker-compose.prod.yml ps` → todos `(healthy)`.
- [ ] `docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --since 30m | grep -iE "error|panic|traceback"`
  → nada inesperado; ningún log con IPs de visitantes, tokens o ids completos (§12, *Registros*).
- [ ] `docker stats --no-stream` → cada contenedor por debajo de su límite (§1).
- [ ] n8n: los 3 flujos activos (§10.2, sin túnel).

### 10.2 n8n: primer arranque

Con el volumen `n8n_data` vacío, el entrypoint (`orchestrator-n8n/entrypoint.sh`) arranca n8n
una vez solo para que cree su base, da de alta al dueño `owner@nexo.local` por su API
(`POST /rest/owner/setup`), lo detiene y sigue con el arranque normal: importa los 3 flujos y los
activa. Con un volumen ya inicializado ese paso se salta y no toca al dueño. En los registros:

```bash
docker logs nexo-n8n-1 2>&1 | grep -E "owner-state|owner-setup|entrypoint|Activated"
# primer arranque:   owner-state: no database yet (fresh volume)
#                    owner-setup: instance owner created (owner@nexo.local)
#                    entrypoint: first boot setup done
# siguientes:        owner-state: owner already set up
# siempre:           Activated "Nexo Deep Route": OK   (y Live Outbound, Live Inbound)
```

**Comprobación** (lee la base; no necesita túnel ni contraseña):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec n8n \
  n8n list:workflow --active=true 2>/dev/null | grep '|'
# f1e2d3c4-…|Nexo Deep Route
# a1b2c3d4-…|Nexo Live Outbound
# b2c3d4e5-…|Nexo Live Inbound
```

Deben salir las tres líneas. Si falta alguna, revisa `docker logs nexo-n8n-1 --tail 80` y
busca `Activated "…": FAILED` o `Patch "…" FAILED`.

**Si el arranque falla** (el contenedor se reinicia en bucle; nunca se imprime la contraseña):

| Mensaje | Causa y arreglo |
|---|---|
| `N8N_OWNER_PASSWORD is not set` | Falta en `.env`. Agrégala y `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d n8n` |
| `n8n rejected the owner setup: Password must …` | n8n exige 8–64 caracteres, al menos un número y una mayúscula. Cambia `N8N_OWNER_PASSWORD` y vuelve a levantar n8n |
| `n8n did not become ready within 180 s` | n8n no terminó sus migraciones: revisa memoria (`docker stats`) y el resto del log |
| `could not create the owner after 5 attempts` | Error del servidor de n8n; el log anterior trae el código HTTP |
| `Login failed (401)` en `activate-via-api` | El dueño ya existe con **otra** contraseña (volumen de un despliegue anterior): pon en `.env` la contraseña original |

Tras corregir, basta volver a levantar n8n: el entrypoint retoma desde donde quedó (base creada
sin dueño → crea el dueño; dueño ya creado → solo importa y activa). No hace falta borrar el
volumen ni arrancar n8n a mano.

---

## 11. Acceder a la UI de n8n en producción

El puerto 5678 **no está publicado**, ni al exterior ni en el host del VPS: solo existe en la
red de Docker. El túnel SSH va a la IP del contenedor:

```bash
# En tu Mac:
N8N_IP=$(ssh deploy@<IP-del-VPS> "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' nexo-n8n-1")
ssh -L 5678:$N8N_IP:5678 deploy@<IP-del-VPS> -N
# En otro terminal, abre: http://localhost:5678
```

(La IP cambia si el contenedor se recrea: repite la primera línea.)

Las credenciales son `owner@nexo.local` y el valor de `N8N_OWNER_PASSWORD` de tu `.env`.

---

## 12. Respaldos cifrados (age)

`make backup-prod` hace un `pg_dump` comprimido (con `--clean`, restaurable sobre una base
existente) y exporta los workflows de n8n, y **cifra ambos con [age](https://age-encryption.org)
en el mismo tubo**: el volcado en claro nunca se escribe en el disco del VPS. Los archivos
(`nexo_db_<fecha>.sql.gz.age`, `n8n_workflows_<fecha>.json.age`) se crean con permisos 600 y se
borran a los 30 días. Sin la clave pública, `backup-prod` falla en vez de dejar un respaldo
en claro.

| Dónde | Qué hay |
|---|---|
| VPS `/opt/nexo/backup-recipients.txt` | Solo la **clave pública** (`age1…`). Con ella se cifra, no se descifra |
| Tu Mac `~/.config/nexo/backup-key.txt` | La **clave privada** (`AGE-SECRET-KEY-1…`). Nunca en el VPS ni en el repo |
| Tu gestor de contraseñas | Una segunda copia de la clave privada: sin ella los respaldos no sirven |

### 12.1 Crear la clave (una vez, en tu Mac)

```bash
brew install age
install -d -m 700 ~/.config/nexo
age-keygen -o ~/.config/nexo/backup-key.txt      # imprime "Public key: age1…"
chmod 600 ~/.config/nexo/backup-key.txt
age-keygen -y ~/.config/nexo/backup-key.txt      # vuelve a mostrar la pública
```

Guarda el contenido de `backup-key.txt` en tu gestor de contraseñas.

### 12.2 Instalar la clave pública y el cron (en el VPS)

```bash
sudo apt-get install -y age
echo 'age1…tu-clave-pública…' > /opt/nexo/backup-recipients.txt   # está en .gitignore
sudo install -d -o deploy -g deploy -m 700 /opt/nexo/backups
cd /opt/nexo && BACKUP_DIR=/opt/nexo/backups make backup-prod      # primera prueba
crontab -e      # como deploy
# Añadir (03:00, antes del posible reinicio de las 04:30):
0 3 * * * cd /opt/nexo && BACKUP_DIR=/opt/nexo/backups make backup-prod >> /opt/nexo/backups/backup.log 2>&1
```

Comprueba al día siguiente: `tail /opt/nexo/backups/backup.log` y `ls -l /opt/nexo/backups`.

### 12.3 Traerlos a tu Mac

Un respaldo en el mismo disco no sobrevive a la pérdida del servidor. Como ya están
cifrados, basta con copiarlos; se tiran desde la Mac (el VPS no necesita acceso a ella):

```bash
mkdir -p ~/nexo-backups
rsync -av --chmod=F600 deploy@<IP-del-VPS>:/opt/nexo/backups/'*.age' ~/nexo-backups/
```

Para hacerlo a diario, una línea en `crontab -e` de la Mac (corre solo si la Mac está
encendida; si no, la siguiente vez trae todo lo que falte):

```bash
30 9 * * * rsync -a --chmod=F600 deploy@<IP-del-VPS>:/opt/nexo/backups/'*.age' ~/nexo-backups/ >> ~/nexo-backups/rsync.log 2>&1
```

En la Mac no se borran solos: limpia de vez en cuando
(`find ~/nexo-backups -name '*.age' -mtime +90 -delete`). Alternativa sin la Mac encendida:
un Hetzner Storage Box con `rsync`/`restic` desde el VPS (los archivos ya van cifrados).

### 12.4 Probar un respaldo (en tu Mac, base desechable)

```bash
cd ~/Desktop/Projects/nexo
make restore-test FILE=~/nexo-backups/nexo_db_<fecha>.sql.gz.age
# AGE_IDENTITY=… si la clave no está en ~/.config/nexo/backup-key.txt
```

Levanta un `pgvector/pgvector:pg17` temporal sin volumen, descifra y carga el volcado en un
tubo, lista las tablas con sus filas y borra el contenedor. Workflows:
`age -d -i ~/.config/nexo/backup-key.txt n8n_workflows_<fecha>.json.age | jq '.[].name'`.

Probado el 2026-10-07 contra el stack de desarrollo: 8 tablas con el mismo número de filas
que la base original, 3 workflows; con una clave equivocada falla y no deja contenedores.

### 12.5 Restaurar de verdad

La clave privada no sube al VPS: se descifra en la Mac y el SQL viaja por SSH.

```bash
# En el VPS: que nadie escriba mientras tanto
cd /opt/nexo && docker compose -f docker-compose.yml -f docker-compose.prod.yml stop gateway agent n8n

# En la Mac
age -d -i ~/.config/nexo/backup-key.txt ~/nexo-backups/nexo_db_<fecha>.sql.gz.age | gunzip \
  | ssh deploy@<IP-del-VPS> 'cd /opt/nexo && docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T postgres psql -U nexo -d nexo -q -v ON_ERROR_STOP=1'

# En el VPS
docker compose -f docker-compose.yml -f docker-compose.prod.yml start agent gateway n8n
```

Workflows de n8n (solo si se perdió el volumen `n8n_data`; el entrypoint ya importa los de
`orchestrator-n8n/workflows/` en cada arranque): descifra el JSON en la Mac, cópialo con `scp`
y usa `n8n import:workflow --input=…` dentro del contenedor.

**Privacidad.** Lo que un visitante borra (`DELETE /api/v1/session/data`, borrar la cuenta)
o lo que caduca por retención sigue en los respaldos hasta 30 días (y en la Mac hasta que los
limpies). Si restauras uno, los datos borrados después de esa fecha vuelven: tras restaurar,
el barrido de retención los vuelve a borrar si ya caducaron, pero un borrado explícito hay que
repetirlo.

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
make prod-check             # ¿falta alguna variable nueva? (no imprime valores)
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
| n8n se reinicia en bucle al primer arranque | §10.2 — `docker logs nexo-n8n-1 2>&1 \| grep -E "owner|entrypoint"` |
| Traefik no obtiene el cert de `www` | Falta el registro DNS de `www.DOMAIN` |
| `make prod-config` falla con "required variable … is missing" | Falta una variable obligatoria en `.env` — ver `.env.prod.example` |
| `make prod-check` marca algo | Lee el nombre que indica; nunca imprime el valor. Compara con `.env.prod.example` |
| `make mail-test` falla en `STARTTLS`/`dial` | Puerto distinto de 587 o `SMTP_TLS` ≠ `starttls`; Hetzner bloquea 25 y 465 |
| `make mail-test` falla al autenticar o en el remitente | `SMTP_USER` debe ser `resend`; API key revocada; dominio sin verificar en Resend |
| Google: `redirect_uri_mismatch` | La URI autorizada en Google Cloud no es exactamente `GOOGLE_REDIRECT_URL` |
| Todas las visitas comparten el límite por IP | El proxy de Cloudflare está activado (nube naranja): vuelve a "DNS only" (§5) |
| El túnel a n8n no conecta | Usa la IP del contenedor, no `localhost` (§11) |
