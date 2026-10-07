# Revisión móvil — 7 de octubre de 2026

Rama `codex/mobile-polish`, desde `codex/chat-suggestions-fix` (`433df83`).
Cambios limitados a `web-nexo/`; contenido, IDs y contrato del backend conservados.

## Comportamiento

- El universo reconoce un arrastre y un pellizco de dos dedos. Conserva el punto
  del mundo bajo el punto medio; el desplazamiento de este punto hace pan. Las
  coordenadas se acumulan y se aplican en el RAF existente, con zoom de 50–200 %.
  Cancelación, pérdida de captura, tercer dedo y regreso a un dedo tienen pruebas.
  Un gesto consume su clic final, pero permite el siguiente toque deliberado.
- El mundo se recorta sin ampliar el viewport móvil. El lienzo controla sus gestos;
  los controles usan `manipulation`. La página de privacidad conserva el zoom
  nativo. Campos de texto de al menos 16 px; sin `user-scalable=no`.
- En móvil el tablero usa el espacio restante, independiente de la cámara que
  queda detrás. Los elementos del universo se ocultan y quedan `inert`. La miniatura
  reserva 84 px en vertical, 140×90 px en horizontal y 26 px con el chat abierto
  (la barra horizontal conserva su columna de 140 px, libre del botón de cierre).
- La arquitectura reutiliza el lienzo, las geometrías y el `TracePlayer` existentes.
  Su hoja ampliada incluye una alternativa textual accesible, atrapa el foco y
  conserva las 64 casillas y la partida; los saltos de ajedrez y
  chat siguen iluminándola. El lienzo compartido se limita a 30 FPS durante la
  partida móvil y se suspende cuando la pestaña está oculta.
- Se reutilizan los dos chats y sus historiales. La hoja inferior ocupa como máximo
  la mitad de la altura visible, tiene pestañas y admite cierre por botón, ESC o
  deslizamiento. `visualViewport` ajusta el campo cuando cambia la altura disponible.
  Una prueba reduce el viewport visible a 320 px: el tablero queda sobre el campo
  de escritura, sin confundir el teclado con un cambio de orientación. Las
  respuestas largas desplazan su historial; un nodo creado ofrece «Ver» sin
  mover la cámara durante la partida.
- Jugadores, turno, historial con scroll y controles tienen regiones separadas.
  Las casillas mantienen objetivos táctiles de 44 px en la vista normal. Con el
  chat abierto la representación se reduce para conservar el tablero visible.
- Los dos botones de volver comparten chevron de 24 px, marco de vidrio, área
  mínima de 44×44 px, contraste, estado pulsado y etiquetas ES/EN. Se reservan
  las áreas seguras; cuenta, bienvenida y visor tienen límites y scroll interno.

## Pruebas reproducibles

Desde `web-nexo/`, primero `npm test` y `npm run build`. En otra terminal:

```sh
npm run preview -- --port 4196
```

Contra ese build de producción:

```sh
MOBILE_URL=http://127.0.0.1:4196 npm run test:mobile
PERF_URL=http://127.0.0.1:4196 CHESS_QA_OUTPUT=docs/mobile/desktop npm run test:browser
npm run test:forming-browser -- http://127.0.0.1:4196
npm run test:media-browser -- http://127.0.0.1:4196
npm run test:privacy-browser -- http://127.0.0.1:4196
PERF_URL=http://127.0.0.1:4196 npm run perf -- docs/mobile/performance.json
```

No ejecutar otras pruebas o builds durante `perf`.

`mobile-fixture.mjs` contiene HTTP y WS simulados del contrato y una partida real
para el motor del cliente. No envía mensajes ni jugadas al backend real.
`mobile-browser.mjs` usa `hasTouch`/`isMobile` con iPhone 13 y Pixel 7: 390×844,
844×390, 412×839, 839×412 y 360×640. CDP inyecta dos dedos reales del protocolo
para comprobar zoom, arrastre, ausencia de selección accidental y escala de página.
También juega e2–e4, comprueba los saltos de ajedrez, la conservación de la partida,
ambos chats, indicador de mensaje nuevo, respuesta larga, aviso de nodo, regreso
manual, ausencia de scroll horizontal y pellizco nativo en privacidad.

`mobile-webkit.mjs` comprueba WebKit con iPhone 13 a 390×844, 844×390 y 360×640,
en ES/EN: doble toque, cuenta, bienvenida, tablero, sistema, chat y privacidad.
WebKit no expone una inyección multitáctil equivalente a CDP: el pellizco de la
aplicación se comprueba allí con Pointer Events y en Chromium con entrada táctil
nativa. [Resultados Chromium](results.json), [WebKit](webkit-results.json) y
[14 casos ES/EN del tablero](desktop/performance-layouts.json).

También pasan las pruebas de carga fría, respuesta HTTP retenida, drag de pieza,
foco y reutilización de casillas; formación/cámara en escritorio y movimiento
reducido; imágenes altas y anchas; privacidad y borrado. `npm test`: 171 pruebas.

## Rendimiento de producción

Chrome 154.0.8037.98, Apple M2, 8 núcleos, DPR 2, 1366×768, 12 nodos generados,
tres contextos por compilación. La referencia se compiló aislada desde `433df83`
y se midió con el mismo script, sin procesos de pruebas simultáneos.

| Métrica | Rama de origen | Mobile polish |
| --- | ---: | ---: |
| Interacción tras clic | 63.8 ms | 44.1 ms |
| FPS de cámara | 60.1 | 60.1 |
| Fotogramas perdidos ajustados por apertura | 1.33 | 1.00 |
| Tareas >50 ms | 0 | 0 |

Se mantienen las metas y no se observa una regresión material frente a la
referencia ni a [performance.md](../performance.md). Los FPS medios coinciden
a una cifra decimal; son mediciones de tres repeticiones, no una garantía en
otros dispositivos. Se conservan los datos
por repetición: [referencia](performance-baseline.json) y [final](performance.json).
También se conserva la [primera pasada](performance-first.json): 44,0 ms,
58,6 FPS, cero tareas largas; sus FPS fueron 55,2 / 60,2 / 60,3. La comparación
anterior se hizo después de compilar la referencia para contrastar esa dispersión.

## Capturas

Capturas a escala CSS, desde builds de producción de la referencia y de esta rama:

| Vista | Antes | Después |
| --- | --- | --- |
| Universo 390×844 | [antes](before-universe-390x844.png) | [después](after-universe-390x844.png) |
| Ajedrez 390×844 | [antes](before-chess-390x844.png) | [después](after-chess-390x844.png) |
| Universo 360×640 | [antes](before-universe-360x640.png) | [después](after-universe-360x640.png) |
| Ajedrez 360×640 | [antes](before-chess-360x640.png) | [después](after-chess-360x640.png) |

[Chat](after-chat-390x844.png), [chat compacto](after-chat-360x640.png),
[arquitectura ampliada](after-system-sheet-390x844.png) y
[aviso de nodo creado](after-generated-node-360x640.png).

## Verificación pendiente en teléfonos físicos

La emulación no reproduce el teclado y su barra de sugerencias, la muesca y áreas
seguras físicas, las barras y el gesto nativo de volver de Safari, VoiceOver/TalkBack en dispositivo, ni el rendimiento
térmico y consumo de un teléfono. La implementación usa `dvh`, `visualViewport`
y `env(safe-area-inset-*)`; esos detalles deben confirmarse en iPhone/Android reales.
