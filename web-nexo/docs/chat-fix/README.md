# Chat en vivo: estados, orden y panel

Validación del 8 de octubre de 2026, desde `origin/main` (`19e1013`), solo con
cambios en `web-nexo/`. Se leyeron el manejador del gateway y la sección del
chat en vivo del contrato; no se modificó ningún servicio.

## Causas reproducidas

- Un `202 { message_id, run_id }` dejaba la burbuja en `sending`. Una pérdida
  posterior del WebSocket convertía tanto `sending` como **todos** los `sent`
  en `failed`, incluidos los del historial y los de Kirbith. Eso generaba los
  falsos errores y botones Retry. Antes de la corrección, las nuevas pruebas
  del contrato fallaron en tres casos; la compilación de producción también
  mostraba «Sending…» después de aceptar un POST sin evento de entrega.
- La cola `preauth` existente ya conservaba ejecuciones completas que llegaban
  antes del POST. Se mantiene y se añade un búfer acotado por `message_id` y
  `run_id`, comprobado también con una entrega aislada antes de `run.start`.
  El 202 marca Sent inmediatamente; solo un fallo HTTP/red o una indicación
  explícita del servidor marca Failed. Delivered nunca retrocede a Sent por
  una confirmación tardía. Kirbith y el historial son Delivered, sin reintento.
- La lista solo hacía `append`, sin ordenar por fecha. Ahora ordena por
  `created_at` (o `ts`, del contrato) y por ID para desempatar. La confirmación
  conserva la burbuja y fecha optimistas, y un reintento exitoso reemplaza la
  burbuja fallida. La recarga y las respuestas nuevas conservan el orden.
- El navegador reprodujo otra carrera: cargar historial con sesión y luego
  terminar el primer `authMe` vaciaba la lista. El cambio de sesión ahora vuelve
  a cargarla con la identidad definitiva, con protección frente a respuestas
  antiguas.

**Historial y servidor:** el contrato `LiveMessage` no incluye un estado de
entrega. `Handler.Get` transmite el cuerpo del agente sin añadir estados ni
ordenarlo. Los archivos autorizados no permiten confirmar si el agente en
producción devuelve orden descendente; las pruebas reproducen explícitamente
ese orden, sin estado, y verifican el resultado ascendente en el cliente.

**Idempotencia:** el POST leído acepta `text` y `name` y genera IDs nuevos en
cada petición. No implementa clave de idempotencia. El cliente evita duplicar
la burbuja al reintentar, pero una respuesta de red perdida después de aceptar
el mensaje requeriría idempotencia en el servidor para garantizar un único
envío a Telegram.

## Interacción y presentación

La misma lista y política de scroll sirven al panel normal y al chat del
ajedrez. Abrir o enviar baja al final; recibir mientras se lee el historial
mantiene la posición y muestra un botón localizado con flecha SVG. El panel
normal es un modal opaco, con fondo atenuado, `inert`, foco atrapado, Escape y
restauración del foco. Los elementos que el renderizador marca visibles no
pueden sobrescribir la ocultación del modal. El ajedrez móvil mantiene su dock
y tablero, con una superficie también opaca.

El campo empieza con una línea, crece hasta cuatro y mantiene el envío a su
lado y el contador visible. La geometría compartida del dock reserva espacio
para el campo, los controles y la privacidad cuando aparece el teclado; el
panel sigue `visualViewport`. La ventana del sistema despeja la cabecera y,
en horizontal, también los nodos principales. El universo baja a 30 FPS detrás
del panel; no se añadió desenfoque animado. Se conserva movimiento reducido.

## Pruebas y reproducción

- `npm test`: **188/188**; `npm run build`: correcto. Incluye MockBackend,
  estados HTTP reales, preauth, reconexión, reintento sin duplicación, orden,
  scroll, cadencia y geometría con teclado.
- [Navegadores](browser-results.json): Chromium 1366×768 con chat normal y
  sobre ajedrez; WebKit, iPhone 13, 390×844, ES/EN, normal y dock del ajedrez.
  Comprueba entrega antes/después del POST con el decodificador real de WS,
  202 sin evento, fallo HTTP y Retry, mensajes owner, reconexión y recarga con
  historial descendente sin estado, lectura sin saltos, envío al final,
  opacidad, foco y cuatro líneas con `visualViewport` de 320 px. No aparecen
  botones Retry transitorios en las carreras de entrega.
- [Regresión móvil](mobile-results.json): seis casos Chromium/WebKit,
  393×851, 851×393, 360×640, 390×844, 844×390 y 360×640, con gestos,
  navegación, cuenta, idioma, ajedrez, historial, chats y teclado.
- Capturas realizadas en **una sola corrida** a 390×844:
  [universo](390x844-universe.png), [panel normal](390x844-live-chat.png),
  [chat del ajedrez](390x844-chess-chat.png). Se revisaron visualmente.

Desde `web-nexo/`, con la compilación de producción:

```sh
npm test
npm run build
npm run preview -- --port 4196
# En otra terminal; no ejecutar otras pruebas durante perf.
CHAT_URL=http://127.0.0.1:4196 QA_CAPTURE=1 npm run test:live-browser
MOBILE_URL=http://127.0.0.1:4196 npm run test:mobile-ui
PERF_URL=http://127.0.0.1:4196 PERF_CAPTURE=0 npm run perf -- docs/chat-fix/performance.json
```

La fixture está en `tests/fixtures/live-contract.json`; el navegador envía
los sobres v2 por WebSocket y el POST por HTTP a través de RealBackend,
sin exponer accesos de prueba en la aplicación. `CHAT_CASE=webkit-normal`,
`webkit-chess`, `chromium-normal` o `chromium-chess` selecciona un caso.

## Rendimiento

Mismo Apple M2 / Chrome 154, producción, DPR 2, 1366×768 y 12 nodos generados;
tres repeticiones sin otras pruebas simultáneas. Se compara con la última
medición publicada en `docs/mobile/ui/performance.json`.

| Métrica | Base publicada | Chat corregido |
|---|---:|---:|
| Tablero interactivo, media | 43.9 ms | 43.2 ms |
| Cámara, FPS medios | 60.06 | 60.05 |
| Fotogramas perdidos inesperados, media | 1 | 1 |
| Tareas largas durante apertura | 0 | 0 |

Sin regresión frente a `docs/performance.md`, dentro de la variación de las
pasadas. [Resultados completos](performance.json). Los fotogramas omitidos
por la cadencia intencional de 30 FPS se distinguen de pérdidas inesperadas.
