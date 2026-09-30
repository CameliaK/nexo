# Nexo — CLAUDE.md

Portafolio-sistema-distribuido de Kirbith Cubillas. Un universo de nodos (esferas/octaedros
en wireframe) que representa su información y, al hacer algo en el sitio (preguntarle a un
agente, escribirle un mensaje en vivo), la petición viaja de verdad por un backend políglota
y ese recorrido se ve iluminado en tiempo real en una "ventana al sistema".

## Estado actual

- **Frontend: terminado y probado.** `web-react/` (a pesar del nombre, es TypeScript vanilla +
  Vite, no React — así se llamó desde que lo generó GPT Astra/Codex). Las 4 fases están hechas:
  universo de nodos, ventana al sistema con entrada de cámara, chat en vivo, chat con el agente.
  Corre contra un `MockBackend` que reproduce `src/data/mock-scenarios.json`.
  `npm test` (13 tests) debe pasar siempre antes de cualquier merge a `main`.
- **Backend: no existe todavía.** Esto es lo que construimos ahora, desde cero.
- **La especificación completa del backend ya está escrita** en `docs/contrato-backend.md`,
  `docs/backend-types.ts`, `docs/backend-architecture.json` y `docs/mock-scenarios.json`.
  **Estos archivos son la fuente de verdad. No hay que inventar el contrato — hay que
  implementarlo tal cual está escrito.** Si algo no está claro ahí, pregunta antes de asumir.

## Reglas de trabajo (repetidas de fases anteriores, por las buenas razones)

1. **Verifica firmas reales de librerías externas antes de usarlas.** No asumas la API de un
   paquete — confírmala (documentación oficial, `go doc`, lo que aplique). Ya tuvimos bugs por
   asumir una API de PASETO que no era la real.
2. **Confirma la versión del lenguaje/runtime contra las dependencias que vas a usar**, antes de
   escribir el Dockerfile. Ya tuvimos que subir Go de 1.23 a 1.26 a mitad de una fase por esto.
3. **Trabajamos fase por fase, con plan antes de ejecución.** Da el plan (paquetes, endpoints,
   schema), espera aprobación, luego ejecuta.
4. **Cada fase termina verificada**, no solo "construida". Build sin caché, logs limpios,
   pruebas manuales de los endpoints antes de dar la fase por buena.
5. Si un build falla, pega el log completo, no solo la última línea.

## Stack y decisiones ya tomadas

- **Un solo VPS** (Hetzner) con Docker Compose + Traefik. Nada de servicios gestionados externos
  (no Supabase aquí — esa es la decisión de otro proyecto, el SaaS de restaurantes).
- **Postgres + pgvector** en su propio contenedor, con volumen persistente.
- **Go** para el Gateway/Auth. **Python + FastAPI** para el agente y el RAG. **n8n** para los
  flujos largos (crear nodos generados, chat en vivo). **Redis** para sesiones y Pub/Sub.
  **C# queda descartado.** Java (Core) quedó en pausa — la carpeta `core-java/` existe pero no
  se retoma por ahora.
- **Chat en vivo: Telegram**, no WhatsApp (la API de WhatsApp tiene demasiada fricción para un
  proyecto personal — ventana de 24h, plantillas de pago, número de negocio ajeno).
- **Ajedrez oculto:** reservado para mucho después. No se construye todavía; el contrato ya
  dejó el espacio preparado (ids de componente abiertos, visitor_id persistente).

## Estructura del monorepo

```
nexo/
├── docker-compose.yml
├── docker-compose.prod.yml
├── traefik/
├── gateway-go/
├── core-java/          (en pausa, no tocar)
├── ai-python/          ← agente + RAG, por construir
├── orchestrator-n8n/   ← por construir
├── web-react/          ← YA TERMINADO, no reescribir sin que se pida explícitamente
├── web-angular/         (futuro: dashboard de observabilidad)
├── observability/
└── docs/
    ├── contrato-backend.md      ← ESPECIFICACIÓN DEL BACKEND, fuente de verdad
    ├── backend-types.ts         ← contrato TypeScript (espejo de lo que el backend debe emitir)
    ├── backend-architecture.json ← los 9 componentes del sistema y sus conexiones
    ├── mock-scenarios.json      ← lo que el frontend YA espera recibir; úsalo como oráculo
    └── portfolio-content.json   ← contenido de los nodos (para referencia del agente/RAG)
```

## Lo esencial del contrato (resumen — el detalle completo vive en docs/contrato-backend.md)

- **Cómo se identifica al visitante:** UUID en `localStorage` del navegador, mandado como header
  `X-Visitor-Id` al pedir `GET /auth/guest`. El gateway lo mete en el token PASETO v4 local.
- **Enrutamiento de eventos por visitante — CRÍTICO:** cada visitante tiene su propio canal de
  Redis (`events:{visitor_id}`). El WebSocket del gateway se suscribe SOLO al canal de quien
  abrió esa conexión. **Nunca broadcast a todas las conexiones** — ese fue justo el bug que
  dejamos pendiente en el intento anterior del Gateway.
- **Todo evento va con el mismo sobre:** `{ v: 2, type, run_id, seq, ts, data }`. `seq` empieza
  en 1 por cada `run_id`.
- **Dos rutas:** rápida (`route`, sin pasar por n8n) y profunda (`generated`/`unknown`, con n8n).
- **`trace.hop`:** cada tramo que la petición recorre entre componentes del backend debe
  publicarse como este evento (`start` → `end` o `error`), para que la UI ilumine la
  arquitectura en vivo. Es la "regla de oro" del proyecto: todo lo que hace el backend se ve.
- **Chat en vivo:** el mensaje del visitante llega a Telegram; la respuesta del dueño regresa
  como evento `live.message` incluso si el visitante no hizo nada (`kind: "live_in"`) — esto
  debe iluminar la arquitectura sin mover la cámara del visitante.
- **Nodos generados:** el agente solo puede devolver uno de 5 `layout` cerrados (`text`, `list`,
  `timeline`, `tags`, `metrics`), validado contra un esquema, máximo 4 hijos sin nietos, y
  siempre con `sources`. Nunca inventa información fuera de lo que el RAG le dio.

## Fases del backend

**Fase 0 — Traefik + esqueleto vivo.**
`docker-compose.yml`, Traefik con TLS (Let's Encrypt en prod, `insecure: true` en dev),
`web-react/` servido detrás de Traefik (nginx), health check trivial. Verificar con `make dev`
y confirmar en el navegador antes de seguir.

**Fase 1 — Gateway (Go).**
`GET /auth/guest` (con `X-Visitor-Id` → token PASETO v4 local), sesión en Redis, hub de
WebSocket **enrutado por visitante** (no broadcast — ver arriba), `GET /health`. Sin agente ni
n8n todavía: puedes probar el WS con eventos de prueba publicados a mano en Redis.

**Fase 2 — Agente (Python + FastAPI), ruta rápida solamente.**
Carga `docs/portfolio-content.json` al arrancar. Recibe una pregunta, decide `route` con un
umbral de confianza (0.7 inicial), responde con los eventos del contrato
(`run.start` → `process.step`×N → `route.plan` → `route.step`×N → `answer.chunk`×N →
`run.done`), publicando a Redis en el canal del visitante correcto. Compara la salida contra
`docs/mock-scenarios.json` (escenario `route-infosys`) como referencia de qué se espera.

**Fase 3 — Postgres + pgvector + ruta profunda (RAG).**
Ingesta del CV/portafolio como fragmentos con embeddings. El agente decide `generated` o
`unknown` cuando no hay `route`. Diseño del nodo generado contra el esquema cerrado.

**Fase 4 — n8n.**
El flujo de la ruta profunda (búsqueda → diseño de nodo → guardado), cada paso emitiendo su
propio `trace.hop`. Aquí `ai-python` deja de responder directo y empieza a lanzar el flujo.

**Fase 5 — Chat en vivo (Telegram).**
`POST /api/v1/live/messages`, `GET /api/v1/live/messages`, el bot de Telegram, y el flujo n8n
de envío/recepción con sus `trace.hop`. Probar especialmente el caso `live_in` sin acción del
visitante.

**Fase 6 — Producción.**
`docker-compose.prod.yml`, TLS real de Let's Encrypt, despliegue al VPS de Hetzner.

**Fase 7 (futura) — Ajedrez oculto, nodo de CI/CD, notificación de n8n por cada demo corrida.**

## Cómo probar cada fase

No des una fase por terminada solo porque compiló. El estándar es:
1. Build sin caché (`docker compose build --no-cache <servicio>`).
2. Logs limpios (`docker logs <servicio> --tail 80`, sin excepciones).
3. Prueba manual del endpoint/evento nuevo (curl, o publicando a mano en Redis si aún no hay
   quien dispare el evento real).
4. Si la fase toca algo que el frontend consume, levantar `web-react` también y confirmar en
   el navegador con `VITE_BACKEND=real`.
