# UI móvil: revisión A–F

Base: `origin/main` (`6356991`), comparada con la apariencia anterior a
`mobile-polish` mediante `git log` y `git show 4d6e658^`. Solo cambia `web-nexo/`;
los IDs, los contratos del backend y MockBackend se conservan.

- **A:** la entrada al sistema reutiliza el mismo renderizador del universo y sus
  `trace.hop`, sin fondo, borde ni esquinas. Solo la vista expandida tiene una hoja
  de cristal con asa y cierre.
- **B:** iconos de acciones SVG de 24 unidades, trazo 1.75, `currentColor` y extremos
  redondeados. Cerrar/volver tienen un área de 44×44. Cuenta usa la figura de una
  persona; la prueba de fuente y el escaneo del DOM rechazan símbolos con
  presentación de emoji, salvo texto semántico con U+FE0E.
- **C:** el tablero vertical conserva 378×343 a 390×844 y 348×316 a 360×640.
  Debajo están la tira SAN, el historial en una hoja, y los tres controles sin
  tarjeta. Abandonar conserva la confirmación. Se reserva `max(safeBottom,16)+56`
  en vertical; el rail lateral horizontal reserva `max(safeBottom,16)+16`.
- **D:** los chats existentes se alojan en una hoja del 55 % del espacio seguro,
  con asa, X, pestañas segmentadas, globos, horas y estado de envío. El campo tiene
  el envío dentro y una línea breve enlazada a privacidad. Los avisos legales
  completos siguen en el DOM para tecnologías de asistencia y en escritorio.
  `visualViewport` ajusta el campo al teclado; no se recrea el tablero ni los chats.
- **E:** bienvenida con un solo botón; ES/EN, ESC/Enter, persistencia, foco y ayuda
  conservados. El indicador ES/EN del encabezado ahora es texto.
- **F:** leyenda/privacidad, indicación y controles tienen posiciones independientes.
  Idioma/ayuda/cuenta forman un grupo; zoom ocupa el otro extremo. Ambos dejan
  `max(safeBottom,16)+56` bajo el pie. La etiqueta completa de ajedrez se reserva en
  las zonas libres; en horizontal la constelación se extiende en una fila. Nexo
  cede ante las áreas de toque y los controles para no interceptar un nodo.

## Repetir

```sh
npm test
npm run build
npm run preview -- --port 4196
# Otra terminal, contra la compilación anterior:
QA_CAPTURE=0 npm run test:mobile
QA_CAPTURE=0 npm run test:mobile-ui
npm run test:chess-transition-browser
PERF_URL=http://127.0.0.1:4196 QA_CAPTURE=0 npm run test:browser
# Al final, sin compilaciones u otras pruebas concurrentes:
PERF_URL=http://127.0.0.1:4196 PERF_RUNS=3 npm run perf -- docs/mobile/ui/performance.json
```

`mobile-ui-browser.mjs` prueba Chromium/Pixel 7 y WebKit/iPhone 13 en vertical y
horizontal, además de 360×640. Comprueba estilos calculados sin recuadro,
iconos/emoji, texto dentro de pantalla, reserva inferior, botones de cierre,
bienvenida, ambos idiomas, toque normal de los cinco nodos, jugadas, historial,
confirmación, chat, entrada del sistema, trazas, aviso de nodo generado y la entrada del dueño a Mi panel. La suite
anterior añade el pellizco nativo de Chromium, doble toque, deslizamiento, envío,
teclado simulado y navegación. WebKit usa Pointer Events para el pellizco porque
su protocolo no proporciona inyección multitáctil nativa.

## Capturas

Comparación de main y la versión final, en WebKit, a escala CSS. `before-*` y `after-*` corresponden a universo, ajedrez y chat en 390×844 y
360×640. La vista final de ajedrez muestra `1. e4` para ilustrar la tira de jugadas;
el chat final muestra un mensaje por remitente. Se generan las capturas finales
solo con `QA_CAPTURE=1 npm run test:mobile-ui`; las demás suites no las escriben.

Los informes JSON registran resultados de UI, gestos, WebKit y los 14 casos ES/EN
de escritorio. Los datos HTTP/WS son fixtures del contrato real; no se envían
mensajes ni jugadas a un backend real.

## Pendiente de comprobar en un iPhone físico

La barra flotante real de Safari, sus cambios de altura, notch/Dynamic Island,
el teclado nativo y su autocorrección, VoiceOver, orientación con las áreas seguras
reales y el rendimiento térmico. WebKit confirma geometría e interacción del
motor; la emulación no reproduce estos elementos del sistema operativo. El
teclado y su área visible se prueban mediante `visualViewport` simulado.

## Rendimiento

Producción, Chrome 154, Apple M2, 1366×768, DPR 2, 12 nodos generados, tres muestras.
Comparación con `../fix/performance.json`; nueva corrida en `performance.json`.

| Medida | Base | Final |
| --- | ---: | ---: |
| Tablero interactivo | 42.2 ms | 43.9 ms |
| FPS durante arrastre | 60.1 | 60.1 |
| Fotogramas perdidos adicionales | 1 | 1 |
| Tareas largas durante apertura | 0 | 0 |

Una pasada anterior de validación dio 42.1 ms y 60.2 FPS. La diferencia de 1.7 ms
respecto a la base es menor que la variación entre pasadas; se mantiene el coste de
fotogramas y tareas largas. Los fotogramas adicionales descuentan la reducción
intencional a 30 FPS bajo un panel. El resultado supera 55 FPS y queda muy por
debajo de 250 ms; no es una medición de rendimiento de un iPhone físico.

| Vista | Antes | Después |
| --- | --- | --- |
| Universo 390 | [PNG](before-universe-390.png) | [PNG](after-universe-390.png) |
| Ajedrez 390 | [PNG](before-chess-390.png) | [PNG](after-chess-390.png) |
| Chat 390 | [PNG](before-chat-390.png) | [PNG](after-chat-390.png) |
| Universo 360 | [PNG](before-universe-360.png) | [PNG](after-universe-360.png) |
| Ajedrez 360 | [PNG](before-chess-360.png) | [PNG](after-chess-360.png) |
| Chat 360 | [PNG](before-chat-360.png) | [PNG](after-chat-360.png) |
