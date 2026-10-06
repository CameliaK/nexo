# Arquitectura del backend y contrato con el frontend (v2)

El backend se va a reconstruir desde cero, incluido Traefik. Antes de eso, el **frontend se construye completo con un backend simulado**, para que cuando el backend exista solo haya que cambiar una variable de entorno.

Este documento es **solo para la UI**: no hay que escribir nada de Go, Python ni n8n. Lo que describe del backend es lo que la UI necesita saber para dibujarlo, iluminarlo y conectarse a él.

| Archivo | Para qué sirve |
|---|---|
| `contrato-backend.md` | Este documento |
| `backend-types.ts` | Tipos del contrato (eventos, trazas, chat en vivo, nodos generados) y la interfaz `PortfolioBackend` |
| `backend-architecture.json` | El grafo de componentes del backend que la UI dibuja y ilumina |
| `mock-scenarios.json` | Secuencias de eventos simuladas para probar la UI sin backend |
| `portfolio-content.json` | El contenido del portafolio (versión 3) |

---

## 1. La idea en una página

- **El portafolio funciona completo sin backend.** Todo el contenido vive en el frontend. Un clic en un nodo nunca hace una petición de red.
- **El backend solo se usa en dos casos:** el chat con el agente y el chat en vivo conmigo.
- **Regla de oro: todo lo que haga el backend se ve en la arquitectura.** Cada vez que una petición pasa por un componente (Traefik, gateway, agente, n8n, Redis, base de datos, modelo de lenguaje, mi teléfono), ese componente se ilumina en la arquitectura, y el visitante ve cómo funciona la aplicación mientras la usa. La arquitectura se ve a través de una **ventana** siempre presente al sistema de atrás; al hacer clic en ella, la cámara entra a ese sistema y lo ve en grande.
- **Un agente decide una de tres cosas** con cada pregunta:
  1. **`route`:** la información ya está en un nodo, así que lo lleva por los nodos hasta llegar.
  2. **`generated`:** no hay nodo, pero la base de conocimiento (RAG) tiene información útil, así que se crea un nodo nuevo.
  3. **`unknown`:** no hay información en ningún lado, y el agente lo dice en vez de inventar.
- **Los nodos generados son solo de ese visitante.** No se conectan a nada y se guardan para cuando vuelva.
- **Chat en vivo:** el visitante me escribe desde un nodo, el mensaje me llega a mi teléfono (por Telegram, solo lo uso yo), y mi respuesta aparece en su pantalla. Cuando yo respondo, la arquitectura se ilumina en su pantalla aunque él no esté haciendo nada.

---

## 2. Piezas del backend

| Pieza | Tecnología | Responsabilidad |
|---|---|---|
| Traefik | Traefik | Única entrada. Pone el HTTPS y envía `/health`, `/auth`, `/api` y `/ws` al gateway, y el resto al frontend |
| Gateway | Go | Identifica al visitante (token), limita el uso, reenvía las preguntas y empuja los eventos al navegador por WebSocket |
| Redis | Redis | Sesiones y Pub/Sub de eventos entre servicios y gateway |
| Agente | Python + FastAPI | Decide `route` / `generated` / `unknown`, hace el RAG, diseña los nodos nuevos. El proveedor de LLM va detrás de una interfaz |
| Orquestador | n8n | Los flujos largos: crear un nodo nuevo y enviar/recibir los mensajes del chat en vivo |
| Datos | Postgres + pgvector | Vectores del RAG, nodos generados y mensajes del chat en vivo |
| Mi teléfono | WhatsApp o Telegram | Donde recibo los mensajes del chat en vivo y respondo |

```
                                        ┌──────────▶ Postgres + pgvector
Navegador ⇄ Traefik ⇄ Gateway (Go) ──▶ Agente (FastAPI) ──▶ Modelo de lenguaje
                 ▲         │                 │
                 │         │                 └── flujos largos ──▶ n8n ──▶ Mi teléfono
                 │         ▼                                        │
                 └─ WebSocket ◀── Redis Pub/Sub ◀── eventos ◀───────┘
```

La versión completa, con todas las aristas, está en `backend-architecture.json`.

---

## 3. Cómo sabe el backend a quién iluminarle el camino

Es la pregunta clave: si hay mucha gente en el sitio, ¿a quién le llegan los eventos de cada petición?

1. **El token identifica al visitante.** Al entrar, el frontend pide `GET /auth/guest` con su `X-Visitor-Id` (un UUID aleatorio guardado en `localStorage`). El gateway lo mete dentro del token firmado.
2. **Cada petición recibe un `run_id`.** El gateway lo crea, lo asocia al visitante y lo pasa al agente o a n8n junto con el trabajo.
3. **Cada servicio publica en el canal del visitante.** Los eventos van a un canal de Redis que incluye el id del visitante (por ejemplo `events:{visitor_id}`).
4. **El gateway reenvía.** Cuando un visitante abre su WebSocket, el gateway se suscribe a *su* canal, y todo lo que llegue ahí lo empuja solo a *sus* conexiones. Si tiene dos pestañas abiertas, llega a las dos.
5. **El frontend nunca elige ni envía ids de destino.** Solo escucha su propio socket.

Por qué es seguro: el id del visitante sale del token validado, nunca del cuerpo de la petición, y el `run_id` es un identificador aleatorio imposible de adivinar. Nadie puede suscribirse al canal de otro.

**Consecuencia para la UI:** un visitante con dos pestañas recibe los eventos en ambas. Cada pestaña **anima solo las ejecuciones que ella misma inició** (`run_id` conocido) y, además, las respuestas mías del chat en vivo (`live_in`), que no las inicia nadie.

Las respuestas mías del chat en vivo llegan por el mismo mecanismo: el mensaje que envío se asocia a una conversación, esta a un visitante, y el gateway lo empuja a su canal.

---

## 4. Qué vive dónde

| En el frontend | En el backend |
|---|---|
| Contenido de los nodos, jerarquía, textos, arquitecturas | El mapa compacto del mismo contenido (el agente carga `portfolio-content.json` al arrancar) |
| Navegación, zoom, cámara y animaciones | La decisión de a dónde llevar al visitante |
| El grafo de arquitectura y cómo se ilumina | Los eventos reales de cada paso |
| Dibujar los nodos generados | Diseñarlos y guardarlos |

Los dos lados deben usar la misma versión del contenido: `run.start` trae `content_version` (hoy es 3). Si el frontend recibe un id que no existe en su copia, lo ignora.

---

## 5. El agente y sus dos rutas

**Cómo decide:**
1. Recibe la pregunta y el mapa compacto del portafolio (id, padre, `label`, `summary`, `keywords`, `links`).
2. Responde con un JSON estructurado y valida que todos los ids existan.
3. Con confianza de 0.7 o más: **`route`**.
4. Si no, busca en pgvector. Con similitud de 0.75 o más: **`generated`**. Si no: **`unknown`**.

Los umbrales son valores iniciales que se ajustan con pruebas. Todo lo que diga un nodo generado sale de resultados del RAG y muestra sus fuentes; el agente nunca inventa.

**Ruta rápida (`route`):** el gateway pasa la pregunta al agente y este responde directo. **No pasa por n8n**, porque solo sumaría latencia.

**Ruta profunda (`generated` y `unknown`):** el agente lanza un flujo de n8n. Como el visitante ya espera una animación de "pensando", la latencia se disimula. El flujo busca en la base, evalúa si sirve, diseña el nodo con el modelo, valida el esquema, lo guarda y emite `node.spawn`.

**El frontend no sabe ni necesita saber qué servicio emitió cada evento.**

---

## 6. La arquitectura en vivo (la regla de oro)

Cada ejecución se ve en **dos lentes a la vez**:

| Lente | Qué muestra | Eventos |
|---|---|---|
| **Lienzo del portafolio** | La cámara viajando por *mis nodos* hasta la respuesta | `route.plan`, `route.step`, `node.spawn` |
| **Vista de arquitectura** | La petición recorriendo *los componentes del backend* | `trace.hop` |

### Dónde se ve la arquitectura
El sistema de atrás (el backend) es **un segundo universo de nodos**, con el mismo lenguaje visual que el portafolio. Se ve de dos formas:

1. **Ventana al sistema (siempre visible).** Una ventana pequeña anclada a una esquina de la pantalla (abajo a la derecha), presente en **todos los niveles** del portafolio. Como una escotilla o un portal, deja ver los componentes del backend en miniatura: apagados en reposo e iluminándose con los eventos `trace.hop`. Lleva un punto de estado (verde si el backend responde) y se puede minimizar. Debe ser discreta: no compite con el grafo principal.
2. **El sistema en grande.** Al hacer clic en la ventana, **la cámara entra** en ese sistema con la misma transición continua con que se entra a cualquier nodo: zoom hacia la ventana mientras el portafolio se desvanece y se aleja, y los componentes crecen hasta ocupar el espacio. Adentro se ve el grafo completo de `backend-architecture.json`: nodos octagonales agrupados por `layer`, aristas con etiquetas, el diálogo "qué es" al pasar el mouse y la leyenda de flujos. El breadcrumb pasa a "Inicio / Sistema" y "← Volver" hace la animación inversa hacia la ventana. Todo lo que ocurra mientras el visitante está adentro se ilumina en grande.

El nodo **"Este portafolio"** (tipo `system`, dentro de Proyectos personales) lleva **al mismo lugar** que la ventana: abre este mismo sistema en grande. No es una vista distinta.

### El evento `trace.hop`
Cada tramo del recorrido es un evento con `hop_id`, `from`, `to` y `phase`:

- `start`: la petición salió de `from` hacia `to`. **Animación:** una partícula viaja por la arista y `to` se ilumina como *activo* (pulso).
- `end`: `to` terminó. **Animación:** `to` pasa a *completado* (brillo fijo) y, si quieres, una partícula regresa por la arista. Trae `detail` (resultado en pocas palabras, como "3 fragmentos relevantes") y `duration_ms`.
- `error`: falló. **Animación:** destello rojo en `to` y en la arista.

Reglas:
- Un `hop_id` se abre con `start` y se cierra con `end` o `error`. Los tramos pueden estar anidados o solaparse (por ejemplo, gateway→agente sigue abierto mientras el agente habla con el modelo).
- El tramo se dibuja sobre la arista que une `from` y `to`, **sin importar el sentido**.
- `label` (en `start`) dice en lenguaje llano qué hace ese tramo. Muéstralo como una etiqueta corta junto a la arista o en el diálogo del componente.
- Todos los ids de componente existen en `backend-architecture.json`. Si llega uno desconocido, ignora ese evento.

### Tramos que dibuja el frontend por su cuenta
El backend **no reporta** estos dos, porque el frontend los conoce:
- **navegador → Traefik:** se dibuja en el momento de enviar la petición.
- **Redis → gateway → navegador:** se dibuja un pulso corto cada vez que llega *cualquier* evento por el WebSocket. Es literalmente el camino que recorrió.

### Iluminación sin que el visitante haga nada
Hay ejecuciones que el visitante no inicia. La principal: **cuando yo respondo desde Telegram** (`run.start` con `kind: "live_in"`). Deben verse aunque el visitante esté quieto o mirando otra cosa:

- La ventana al sistema se ilumina con el recorrido: mi teléfono → n8n → Postgres → (Redis → gateway → navegador). Si el visitante está dentro del sistema en grande, se ilumina en grande.
- Si el panel del chat en vivo está cerrado, el nodo `live_chat` muestra una insignia de mensaje nuevo y un pulso suave.
- **La cámara nunca se mueve sola por una ejecución `live_in`.** Solo se ilumina y se avisa.
- Requisito: la página está abierta (hay WebSocket). Si el visitante cerró la página no hay nada que iluminar; el mensaje queda guardado y lo verá al volver, con `GET /api/v1/live/messages`.
- Lo mismo aplica a cualquier ejecución que el backend inicie por su cuenta en el futuro.

### Si el visitante está dentro del sistema cuando el agente lo quiere llevar a un nodo
Si pregunta al agente estando dentro del sistema en grande y llegan `route.step`, la cámara **no sale sola**. Se muestra un aviso ("Te llevo a Experiencia › Infosys") con un botón "Ir ahora", y la ruta se reproduce al pulsarlo o al volver al portafolio. Mientras tanto la traza sigue iluminándose en grande.

### Qué recorre cada tipo de ejecución

| Ejecución | Recorrido |
|---|---|
| Pregunta con nodo existente | navegador → Traefik → gateway → agente → modelo de lenguaje → (Redis → gateway → navegador) |
| Pregunta que crea un nodo | … → agente → **n8n** → Postgres, modelo de lenguaje → (Redis → gateway → navegador) |
| Tu mensaje me llega | navegador → Traefik → gateway → Postgres; gateway → n8n → **mi teléfono** |
| Mi respuesta llega a ti | **mi teléfono** → n8n → Postgres → (Redis → gateway → navegador) |

### Honestidad con el visitante
El `MockBackend` es **solo para desarrollo**. En producción nunca se simulan respuestas ni trazas: si el backend no responde, el chat se muestra como no disponible y la arquitectura queda en reposo (componentes apagados). Mientras se desarrolla con el mock, la ventana al sistema y la vista en grande muestran una etiqueta discreta "simulado".

---

## 7. Chat en vivo conmigo

Un nodo (`live_chat`, dentro de Contacto) abre un panel de chat. Lo que el visitante escribe me llega a mi teléfono; lo que respondo desde ahí aparece en su pantalla.

### Flujo
- **Visitante → yo:** `POST /api/v1/live/messages` → el gateway guarda el mensaje en Postgres → n8n lo envía a mi teléfono. Llegan dos avisos de entrega (`live.delivery`).
- **Yo → visitante:** respondo desde el teléfono → n8n recibe mi respuesta → la guarda → la publica → el gateway la empuja por el WebSocket (`live.message` con `from: "owner"`).
- **Si el visitante no está en la página**, la respuesta queda guardada. Al volver, `GET /api/v1/live/messages` devuelve toda la conversación.

### Cómo se ve
- Panel de chat con burbujas. El campo de nombre es opcional y se pide una sola vez.
- Estados de un mensaje del visitante: *enviando* (local, al enviar) → *enviado* (`live.delivery` "sent") → *entregado* (`delivered_to_owner`) → o *no se pudo enviar* (`failed`, con botón para reintentar).
- Mis respuestas aparecen como burbujas mías, con mi nombre.
- Mientras el mensaje viaja, la ventana al sistema (o la vista en grande, si está abierta) muestra el recorrido, y también cuando llega mi respuesta, aunque el visitante no esté haciendo nada.
- Máximo 500 caracteres por mensaje (nombre: 30).

### Del lado del backend (para tener presente)
- **El canal es intercambiable.** El backend habla con mi teléfono a través de una interfaz (`OwnerChannel`); para la UI es indiferente si detrás hay WhatsApp o Telegram.
- **WhatsApp (API oficial):** solo permite mensajes libres dentro de una ventana de 24 horas que se abre cuando el destinatario (yo) le escribe al número del negocio; fuera de esa ventana, solo plantillas aprobadas, que desde julio de 2025 se cobran por mensaje. Además, el envío sale de un número de negocio distinto del mío. Las librerías no oficiales que usan el WhatsApp personal violan los términos del servicio y pueden bloquear el número.
- **Telegram (bot):** sin ventanas ni plantillas, gratis, y ya estaba planeado para los avisos de n8n. Es la forma más simple de empezar.
- **Cómo respondo al visitante correcto:** todos los mensajes llegan a un solo chat. Cada mensaje reenviado empieza con una etiqueta corta (por ejemplo `#A3F2 · Ana`); respondo usando la función de *responder* del mensaje (el backend asocia el mensaje respondido con su conversación), o escribiendo la etiqueta al inicio como alternativa.
- **Antispam:** límite de mensajes por visitante y por hora, tope diario total, sin enlaces en los mensajes y verificación anti-bot antes del primero. Un visitante bloqueado recibe `429`.

---

## 8. Contrato HTTP

- **Mismo dominio:** rutas relativas (`/auth/guest`, `/ws`, `/api/v1/...`). No hay CORS.
- **Autenticación:** `Authorization: Bearer <token>` en `/api/v1/*`.
- Todo se construye de nuevo, incluido lo que ya existía.

| Método y ruta | Qué hace |
|---|---|
| `GET /health` | Estado del gateway |
| `GET /auth/guest` | Con `X-Visitor-Id`. Devuelve `{ "token": "v4.local...." }` (invitado, PASETO v4). El token expira |
| `POST /api/v1/ws-ticket` | Bearer (invitado, usuario o dueño). Devuelve `200 { "ticket", "expires_in": 30 }` con `Cache-Control: no-store`: un código aleatorio de un solo uso, válido 30 s, ligado al visitante y al modo del token |
| `GET /ws?ticket=…` | Abre el WebSocket con un ticket recién pedido. El servidor hace ping cada 30 s |
| `GET /ws?token=…` | **Obsoleto, respaldo temporal.** Sigue funcionando, pero el gateway registra un aviso de deprecación (con el id enmascarado) y se quitará cuando el frontend use tickets |
| `POST /api/v1/chat` | Body `{ "message" }`. Responde `202 { "run_id" }`; los eventos llegan por el WebSocket |
| `GET /api/v1/session/nodes` | `{ "nodes": [GeneratedNode] }` del visitante |
| `DELETE /api/v1/session/nodes/{id}` | Descarta un nodo generado (`204`) |
| `DELETE /api/v1/session/data` | Bearer de invitado o de cuenta. Borra los nodos generados, los mensajes del chat en vivo y la sesión de ese visitante (`204`). Límite: 5/h por visitante y 20/h por IP (`429` con `Retry-After`). La cuenta, si la hay, sigue existiendo (para borrarla: `DELETE /api/v1/account`) |
| `POST /api/v1/live/messages` | Body `{ "text", "name"? }`. Responde `202 { "message_id", "run_id" }` |
| `GET /api/v1/live/messages` | `{ "conversation_id", "messages": [LiveMessage] }` (`conversation_id` es `null` si aún no hay) |

**Errores** (cuerpo `{ "error": { "code", "message" } }`):

| Status | `code` | Cuándo | Qué hace el frontend |
|---|---|---|---|
| 400 | `invalid_request` | Mensaje vacío o demasiado largo | Validar antes de enviar |
| 401 | `unauthorized` | Token vencido | Pedir otro en `/auth/guest` y reintentar una vez |
| 409 | `busy` | Ya hay una consulta al agente en curso | Deshabilitar el envío mientras haya una activa |
| 429 | `rate_limited` | Demasiadas peticiones (header `Retry-After`) | Avisar y bloquear el envío esos segundos |
| 503 | `llm_unavailable` | El proveedor de LLM no responde | Avisar y ofrecer reintentar |
| 500 | `internal` | Error inesperado | Avisar y ofrecer reintentar |

---

## 9. Contrato WebSocket

Todos los mensajes tienen el mismo sobre:

```json
{ "v": 2, "type": "trace.hop", "run_id": "…", "seq": 7, "ts": "2026-10-02T12:00:00Z", "data": { } }
```

`seq` empieza en 1 dentro de cada `run_id`.

| `type` | `data` | Qué hace la UI |
|---|---|---|
| `run.start` | `kind` (`chat` / `live_out` / `live_in`), `input?`, `content_version` | Abre la ejecución: orbe del agente y panel de proceso (solo `chat`), ventana al sistema (siempre) |
| `process.step` | `step`, `status`, `label?` | Actualiza el panel de proceso (solo `chat`) |
| `trace.hop` | `hop_id`, `from`, `to`, `phase`, `label?`, `detail?`, `duration_ms?` | Ilumina el recorrido en la arquitectura (sección 6) |
| `route.plan` | `path[]`, `confidence`, `reason?` | Guarda el camino que se va a recorrer |
| `route.step` | `node_id`, `index` | La cámara viaja a ese nodo y lo ilumina |
| `rag.search` | `query` | Muestra "buscando en la base" |
| `rag.result` | `hits[]`, `used` | Muestra las fuentes encontradas (o que no hubo) |
| `node.spawn` | `anchor`, `node` | Nace un nodo generado |
| `answer.chunk` | `text` | Añade texto al chat del agente (streaming) |
| `live.message` | `conversation_id`, `message` | Añade una burbuja al chat en vivo |
| `live.delivery` | `message_id`, `status` | Actualiza el estado de un mensaje del visitante |
| `run.done` | `outcome`, `duration_ms` | Cierra la ejecución y libera el envío |
| `run.error` | `code`, `message`, `retryable` | Muestra el error y libera el envío |

`outcome`: `route`, `generated`, `unknown`, `delivered` (mensaje entregado a mi teléfono) o `received` (llegó mi respuesta).

**Pasos del panel de proceso** (solo ejecuciones `chat`), en este orden. Los que no se usan llegan como `skipped`:

| `step` | Texto sugerido |
|---|---|
| `understand` | Entendiendo la pregunta |
| `search_nodes` | Buscando en mis nodos |
| `search_base` | Buscando en la base de conocimiento |
| `design_node` | Diseñando el nodo |
| `create_node` | Creando el nodo |
| `answer` | Redactando la respuesta |

**Reglas para el frontend:**
- Ordena por `seq` y descarta duplicados (mismo `run_id` y `seq`).
- **Reproduce los eventos en cola**, uno tras otro, con una duración mínima por paso (por ejemplo 500 ms por `route.step`). Pueden llegar más rápido de lo que la animación necesita, y ninguno debe saltarse.
- `route.plan.path` es una lista ordenada de ids del portafolio. Dos ids consecutivos pueden ser padre→hijo, hijo→padre o estar unidos por `links`. **El frontend calcula el movimiento de cámara**; el backend nunca manda instrucciones de cámara.
- Si un id de `path` no existe en la copia local, corta el camino en el último id válido.
- `node.spawn.anchor` es el nodo cerca del cual aparece el nuevo (solo posición, **nunca se conecta**). Si es `null`, nace del orbe del agente.
- Una ejecución termina con `run.done` o `run.error`. Al cerrarse, cualquier hop que siga abierto pasa a *completado*.
- **Reconexión:** reintenta con espera creciente (1 s, 2 s, 4 s… máximo 15 s). Si la conexión se cae a mitad de una ejecución, muestra "conexión perdida" y ofrece reintentar; los nodos generados y los mensajes que el backend alcanzó a guardar aparecen al recargar `GET /api/v1/session/nodes` y `GET /api/v1/live/messages`.

---

## 10. Nodos generados

Forma exacta en `backend-types.ts` (`GeneratedNode`).

- `id` siempre empieza con `gen_`.
- `layout` es uno de una **lista cerrada**; el agente no puede inventar otros:

| `layout` | `content` | Cómo se ve |
|---|---|---|
| `text` | `{ body }` | Párrafo |
| `list` | `{ items[] }` | Lista de viñetas |
| `timeline` | `{ entries[{ when, what }] }` | Línea de tiempo |
| `tags` | `{ tags[] }` | Etiquetas |
| `metrics` | `{ items[{ label, value }] }` | Cifras destacadas |

- **Hijos:** hasta 4, sin nietos.
- **Límites:** `label` 40 caracteres, `summary` 160, `body` 600, listas y entradas de 6 a 12 elementos según el layout (`LIMITS` en `backend-types.ts`).
- **Fuentes (`sources`):** de dónde salió la información. Una `ref` es el id de un nodo del portafolio (enlace interno) o una URL `https`.
- **Tope por visitante:** 12 nodos generados (propuesta).

**Cómo mostrarlos:** más pequeños y translúcidos, con la etiqueta "generado para ti", **solo texto plano** (nada de HTML ni markdown, porque lo escribe un modelo de lenguaje), con botón para descartarlos. Si un nodo no cumple el esquema o los límites, el frontend lo descarta en vez de mostrarlo roto.

---

## 11. Visitante, sesión y persistencia

- El **token** de invitado expira. El **`visitor_id`** (UUID en `localStorage`) no.
- Los nodos generados y la conversación del chat en vivo se guardan en Postgres por `visitor_id`, con Redis como caché.
- Al cargar la página, el frontend llama a `GET /api/v1/session/nodes` y `GET /api/v1/live/messages`.
- **Retención** (tarea periódica en el agente, cada hora y al arrancar):
  - Nodos generados: se borran tras `NODES_RETENTION_DAYS` (90) días sin actividad. Actividad =
    que el visitante cargue sus nodos (`GET /api/v1/session/nodes`), lo que reinicia el plazo.
  - Mensajes del chat en vivo: cada mensaje se borra `LIVE_RETENTION_DAYS` (180) días después
    de enviado.
  - El visitante puede borrar todo antes con `DELETE /api/v1/session/data`.
- Los logs nunca guardan tokens, correos ni ids completos (ids: primeros 8 caracteres). Docker
  rota los logs de cada servicio (3 × 10 MB). n8n no guarda las ejecuciones correctas y purga
  las fallidas a los 7 días.
- **Si el backend no responde**, el portafolio funciona normal. El chat y el chat en vivo se muestran como no disponibles.

---

## 12. Seguridad y límites

- El gateway limita por visitante y por IP, y permite **una consulta activa** al agente por visitante.
- Mensaje al agente de 500 caracteres como máximo; mensaje del chat en vivo, 500.
- Tope de gasto diario en el proveedor de LLM; al alcanzarlo, `503 llm_unavailable`.
- **Todo lo que genera el modelo es contenido no confiable:** se valida contra el esquema en el backend y otra vez en el frontend, y se muestra como texto plano. Lo mismo para lo que escribe el visitante en el chat en vivo.
- El agente solo puede responder con el JSON del esquema cerrado.
- Ningún secreto en el frontend. El token va en el header (REST); el WebSocket se abre con un
  **ticket de un solo uso** en el query string, nunca con el token (ver abajo).

### Ticket de WebSocket (para el frontend)

El token de sesión no debe viajar en la URL de `/ws`: las URLs acaban en registros de acceso de
proxies y servidores. En su lugar:

1. Justo antes de abrir (y en cada reconexión), `POST /api/v1/ws-ticket` con
   `Authorization: Bearer <token>` → `{ "ticket": "…", "expires_in": 30 }`.
2. Abrir `wss://<dominio>/ws?ticket=<ticket>` antes de que pasen 30 s.

Reglas:
- Un ticket sirve **una sola vez**: reconectar exige pedir otro. Reusar uno usado, caducado o
  inventado da `401` en el handshake.
- El ticket hereda el visitante y el modo del token (`guest` / `user` / `owner`); un ticket de
  dueño suscribe también a `events:owner`. Si el token se revoca (logout, cuenta borrada) entre
  pedir el ticket y canjearlo, el canje falla con `401`.
- Si `POST /api/v1/ws-ticket` responde `401`, el token venció o fue revocado: pedir otro (invitado:
  `GET /auth/guest`) y repetir.
- `?token=` sigue aceptándose temporalmente como respaldo, con aviso de deprecación en los logs.
- No se guarda información personal del visitante; solo un UUID aleatorio, y el nombre si él lo escribe.

---

## 13. Qué debe construir la UI

Solo interfaz. Nada del lado del servidor.

1. **Interfaz `PortfolioBackend`** (`backend-types.ts`). La UI solo importa esa interfaz; nunca usa `fetch` ni `WebSocket` directamente.
2. **`MockBackend`:**
   - Carga `mock-scenarios.json`.
   - Chat: elige el escenario cuyo `match` aparezca en la pregunta (en minúsculas), o `default_scenario`.
   - Chat en vivo: al enviar un mensaje reproduce `live-out` y, pasados 6 s, `live-in` (simula que respondo).
   - Reproduce los eventos respetando `delay_ms` y reemplaza `{{run_id}}`, `{{now}}`, `{{input}}`, `{{message_id}}` y `{{conversation_id}}`.
   - Para probar errores: una pregunta que empiece con `/429` o `/409` devuelve el error HTTP correspondiente de `http_errors`.
3. **`RealBackend`** (solo esqueleto): `connect()` pide `/auth/guest` con `X-Visitor-Id`, abre el WebSocket y pasa cada mensaje por `isBackendEvent`; `sendMessage()` y `sendLiveMessage()` usan `POST`; reconexión con espera creciente.
4. **Selector:** variable de entorno `VITE_BACKEND=mock` o `real` (por defecto `mock`).
5. **El sistema en grande** (nodo `system` "Este portafolio" y destino de la ventana): dibuja `backend-architecture.json` con nodos octagonales agrupados por `layer`; diálogo "qué es" al pasar el mouse; leyenda con los `flows`; estados reposo / activo / completado / error.
6. **Ventana al sistema:** ventana pequeña siempre visible, anclada a una esquina, con los mismos componentes en miniatura. Al hacer clic, la cámara entra al sistema en grande con la misma transición que se usa para entrar a un nodo, y "← Volver" la revierte. Ver sección 6.
7. **Reproductor de trazas:** cola de eventos `trace.hop` con las reglas de la sección 6; alimenta a la vez la ventana y la vista en grande; incluye los dos tramos que dibuja el frontend por su cuenta y la iluminación de las ejecuciones `live_in`.
8. **Chat del agente:** panel con el streaming (`answer.chunk`), panel de proceso, cámara recorriendo `route.step`, y nodos generados que nacen con `node.spawn`.
9. **Nodo `live_chat`:** panel de chat en vivo (sección 7), con el contenido de `portfolio-content.json` (`intro`, `name_label`, `placeholder`, `note`, `max_chars`), con insignia de mensaje nuevo cuando el panel está cerrado.
10. **Panel de desarrollo** (solo con `VITE_BACKEND=mock`): botones que reproducen cada escenario de `mock-scenarios.json`, incluido `live-in` por separado, para probar la iluminación sin escribir nada. No aparece en producción.

**Prueba manual, una pregunta por escenario:**
- "¿Qué hiciste en Infosys?" → `route`
- "¿Qué herramientas de IA usas?" → `generated`
- "¿Cuánto cobras por proyecto?" → `unknown`
- una con la palabra "error" → `error-llm`
- un mensaje en el chat en vivo → `live-out`, y a los 6 s mi respuesta (`live-in`)

Cuando exista el backend, se cambia `VITE_BACKEND=real` y no se toca nada más.

---

## 14. Reservado para después: ajedrez oculto

No se construye ahora. Solo se deja el terreno preparado:

- **Persistencia:** el `visitor_id` ya permite guardar la partida si el visitante se sale y volver a ella.
- **Arquitectura:** los ids de componente son strings abiertos, así que añadir un componente `chess` a `backend-architecture.json` no requiere cambiar tipos.
- **Eventos:** se añadirá una familia nueva (`chess.*`) al mismo sobre. Por eso `isBackendEvent` rechaza tipos desconocidos: la UI debe ignorarlos sin romperse.
- **Nodo:** será un nodo oculto que se activa con un gesto por definir.

---

## 15. Pendiente del lado del backend

- **Traefik** y el resto de la infraestructura, desde cero.
- **Gateway:** token con `visitor_id`, canales de Redis por visitante, WebSocket enrutado por visitante (no broadcast), `POST /api/v1/chat`, endpoints de nodos y del chat en vivo, límites de uso, antispam.
- **Agente (FastAPI):** cargar el mapa del portafolio, decidir el desenlace, hacer el RAG, diseñar el nodo con el esquema cerrado y emitir los eventos, incluidos los `trace.hop`.
- **n8n:** el flujo de la ruta profunda y el flujo del chat en vivo (envío y recepción), cada paso emitiendo su `trace.hop`.
- **Traefik no emite eventos:** el gateway reporta el tramo `traefik → gateway` por él.
- **Postgres + pgvector:** ingerir el CV y el contenido del portafolio como fragmentos con embeddings; tablas de nodos y mensajes por visitante.
- **Canal del dueño** (`OwnerChannel`): Telegram primero, WhatsApp después si se decide.
- **Después:** ajedrez oculto, aviso a Telegram/Discord al terminar una consulta y el nodo de CI/CD.

---

## Apéndice: cambios respecto a la v1

- Contrato `v: 2`. `run.start` ahora trae `kind` e `input?` (antes `question`).
- Evento nuevo `trace.hop` y archivo nuevo `backend-architecture.json`.
- Eventos nuevos `live.message` y `live.delivery`; endpoints del chat en vivo.
- `outcome` suma `delivered` y `received`.
- La interfaz `ChatBackend` ahora se llama `PortfolioBackend` y suma `sendLiveMessage` y `listLiveMessages`.
- `portfolio-content.json` pasa a la versión 3, con dos nodos nuevos: `personal.contacto.chat` (`live_chat`) y `proyectos-personales.este-portafolio` (`system`).
