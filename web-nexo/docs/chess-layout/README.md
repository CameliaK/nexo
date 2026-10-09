# Disposición del ajedrez

## A — acceso único y móvil sin chat

Se eliminó la píldora adicional, sus estilos, traducciones y expectativas de pruebas.
El único nodo existente abre el chat sin abandonar el tablero; su foco se restaura
antes de ocultar la transición. Hasta 900 px, el chat permanece oculto durante
la partida. El contador discreto de Replegar y el del nodo al regresar conservan
los mensajes nuevos. Los datos y reglas del backend no cambian.

Validación de este bloque antes de comenzar B: 192 pruebas, build y
`npm run test:chess-cleanup` contra producción en 4196.
[A-results.json](A-results.json) registra escritorio, iPhone 13/WebKit y
una partida redimensionada a 900 px: clic, Enter, Espacio, Escape/foco,
permanencia de la partida, ausencia del botón y persistencia de mensajes nuevos.
No se tomaron capturas; se reservan para una única corrida final en E.

## B — columnas estables

Margen exterior 40 px, separación 32 px, izquierda 360 px y derecha 340 px
cuando caben. Entre 1180 y 1363 px se reducen proporcionalmente los laterales
para conservar el centro de al menos 520 px, según la preferencia confirmada.
Entre 901 y 1179 px, las franjas laterales son de 220 px; el panel se superpone
al universo en la franja izquierda sin desplazar el tablero.

La cabecera ocupa una fila propia. Los jugadores y ayuda siguen el tablero,
centrado en el espacio central; el pan anterior del universo no desplaza esa
composición. La ventana del sistema usa el mismo componente con 190 px de alto
(160 px en la composición estrecha), encima del panel de estado y jugadas.
El historial ocupa el espacio flexible con scroll interno y destaca el último
par de jugadas. Los controles permiten texto envuelto y el abandono conserva
su confirmación. Se corrigieron el ancho del botón de Replegar y el SVG del
indicador de historial.

`npm run test:chess-geometry` mide DOM real en Chromium y WebKit en los cinco
tamaños solicitados, con chat cerrado y ambas pestañas.
[B-geometry.json](B-geometry.json) contiene rectángulos, controles y comprobación
de desbordamientos. La fixture hace pan real antes del clic si un nodo del mundo
queda inicialmente fuera del viewport; no fuerza el clic sobre un elemento oculto.

## C — formación reversible del mismo nodo

Se parametrizó el reproductor existente del menú inicial con el destino de la
columna izquierda y el token de 900 ms. Conserva un único canvas, nodo y panel;
un cierre o reapertura intermedios parten de la geometría actual. El render usa
60 fps durante la formación y un fundido de 100 ms con movimiento reducido.
Las pestañas cambian sin repetir la formación; conservan borradores y mensajes.
Escape cierra primero el chat, devuelve el foco al nodo y después permite replegar
el ajedrez. Los nodos generados mantienen el aviso sin desplazar la cámara.

194 pruebas y build en verde. `npm run test:chess-morph` verifica ambos motores
con y sin movimiento reducido, interrupciones, foco, borradores, pestaña y aviso:
[C-morph.json](C-morph.json). Las medidas admiten menos de 0,5 px de redondeo,
como las pruebas de geometría; no admiten reflujo del tablero.

## D — vidrio uniforme

Reproducción sobre producción: capturas en memoria arriba y abajo y registro de
estilos en [D-before.json](D-before.json). El asistente usaba `clip-path` en la
superficie, `will-change: transform` en el padre y dos scrolls anidados. Su fondo
mezclaba un relleno verde del 15 % con un pseudo-elemento oscuro del 56 %, sin
`backdrop-filter`. El scroll movía toda esa superficie.

Ahora el fondo y el blur permanecen fijos; únicamente el cuerpo desplaza texto.
Cabecera y pie son transparentes sobre ese mismo fondo. Se retiraron el recorte,
el transform escalado y las promociones de composición de los ancestros; el
pequeño detalle de esquina vive en un pseudo-elemento decorativo. Asistente, chat
en vivo, información y ayudas comparten los tokens de vidrio (64 %, blur 20 px,
16 px en móvil, prefijo Safari). La capa de etiquetas se oculta solo donde queda
bajo el panel, mediante el mecanismo existente de oclusión. Al completar respuestas
el cuerpo sigue desplazándose al final.

194 pruebas, build y `npm run test:assistant-glass` en verde. Seis casos de
Chromium/WebKit a 1440, 1280 y 390 px: [D-glass.json](D-glass.json). Se muestrean
píxeles PNG en una zona vacía, sobre un fondo de control idéntico, arriba y abajo.
La diferencia de opacidad efectiva es 0 en todos los casos (< 5 %). Las capturas
persistidas se producen juntas al terminar E.

## E — geometría, regresiones y capturas finales

Disposición estable, debajo de la cabecera:

```text
40 px | chat 360 | 32 | centro ≥520 | 32 | sistema/estado 340 | 40 px
      | nodo ↔  |    | rival       |    | sistema, 190 alto  |
      | vidrio  |    | tablero     |    | estado              |
      | 2 tabs  |    | jugador     |    | historial con scroll|
      | campo   |    | ayuda       |    | controles / cuenta  |
```

Se reducen los laterales cuando el ancho es 1180–1363 px. Hasta 1179 px se usan
laterales de 220 px; hasta 900 px el ajedrez no muestra chat. El mismo nodo y la
misma ventana del sistema se reubican; el centro no depende del estado del chat.

La matriz definitiva mide **78 estados**: Chromium y WebKit, cinco tamaños,
0/12/80 jugadas legales, cerrado/Chat con Kirbith/Asistente (móvil solo cerrado).
Se simulan `chess.move`, `live.message` y `node.spawn` con sus formas de contrato.
Se verifican intersecciones, controles dentro del panel, áreas internas del panel
separadas, desbordamientos, foco, avisos y tablero invariable (<0,5 px de redondeo).
[E-geometry.json](E-geometry.json) guarda las medidas reales.

La revisión visual detectó una particularidad del elemento `details`: sus hijos
no se distribuían como elementos flex y las filas podían pintar sobre controles
en ventanas bajas. El historial permanentemente visible de escritorio es ahora
una sección con nombre accesible y su propio scroll limitado. La tira móvil es
una vista acotada de las últimas jugadas; abre el historial completo vertical.
La comprobación interna del panel previene ambos desbordamientos. La relación
`aria-controls` del nodo sigue la pestaña seleccionada.

194 pruebas y build en verde. Además:

- [Chat en vivo](live-regression/browser-results.json): confirmación antes/después
  del POST, fallo/reintento, historial descendente, orden, scroll, recarga, foco y
  teclado emulado; escritorio, partida abierta, Pixel 7 y WebKit/iPhone 13.
- [Partida final](live-final-game/browser-results.json): envío y los mismos estados
  tras corregir el contenedor del historial.
- [Vidrio y contraste](glass-regression/browser-results.json): ambas superficies,
  interacción del universo, WCAG AA, partida, trazas, foco y movimiento reducido.
- [Toques móviles](mobile-regression/ui-results.json): todos los nodos públicos del
  nivel 0, idiomas, bienvenida, dueño, movimientos, confirmación de abandono,
  ventana del sistema y mensajes nuevos; seis tamaños/orientaciones.
- `test:chess-transition-browser`: entrada/salida interrumpible, identidad del
  sistema, conservación de 64 casillas y movimiento reducido.
- [Formación final](C-morph.json): ambos motores y preferencias de movimiento,
  inversión desde un punto intermedio, borrador, pestaña, aviso y foco.

[captures.json](captures.json) enumera una sola serie final de 16 capturas a
1440×900, 1280×720 y 390×844: cerrado, formación intermedia, ambas pestañas,
móvil sin chat y asistente en el nivel 0 arriba/abajo. Ejemplos:
[escritorio](1440x900-chess-live.png), [ventana baja](1280x720-chess-live.png),
[móvil](390x844-chess-unread.png), [asistente arriba](390x844-assistant-top.png),
[asistente abajo](390x844-assistant-bottom.png).

### Reproducir

Con Node 24, dependencias instaladas y producción servida en `127.0.0.1:4196`:

```sh
npm test
npm run build
npm run preview -- --port 4196
# En otro terminal:
npm run test:chess-cleanup
npm run test:chess-layout
npm run test:chess-morph
npm run test:assistant-glass
QA_CAPTURE=0 npm run capture:chess-layout
QA_CAPTURE=0 CHAT_QA_OUTPUT=../docs/chess-layout/live-regression/ npm run test:live-browser
QA_CAPTURE=0 UI_QA_OUTPUT=../docs/chess-layout/mobile-regression/ npm run test:mobile-ui
npm run test:chess-transition-browser
PERF_URL=http://127.0.0.1:4196 PERF_CAPTURE=0 npm run perf -- docs/chess-layout/performance-standard.json
```

La captura con `QA_CAPTURE=1` rechaza un manifiesto existente para evitar mezclar
series. La fixture hace pan y clic/toque normales cuando el nodo está fuera de
vista. El benchmark histórico conserva sus clics forzados para comparar la misma
secuencia; las pruebas funcionales validan recepción real del clic y toque.

### Rendimiento y límites de la comprobación

Apple M2, Chrome 154, DPR 2, 12 nodos generados; tres pasadas por perfil, sin otras
pruebas concurrentes. [Protocolo y comparación](../performance.md).
Los seis arrastres estándar promedian **60,21 FPS** y el tablero **46,05 ms**;
no hubo tareas largas. Asistente abierto: **60,00 FPS** en escritorio y móvil
emulado. La repetición instrumentada de formación mide **60,11 FPS** durante
los 900 ms, sin fotogramas de más de 40 ms ni tareas largas.

La primera serie de formación incluye una pausa aislada de 532,5 ms sin tarea
larga asociada. Se conserva ese dato en [performance-formation.json](performance-formation.json);
no se reprodujo en las tres pasadas de [performance-repeat.json](performance-repeat.json),
que también observan el RAF del navegador. No se atribuye una causa sin evidencia.
La apertura estándar subió 7,2 ms frente a la media publicada de 38,8 ms (menos
de un fotograma de 60 Hz); los FPS permanecen iguales y se cumple ampliamente
el presupuesto de 250 ms. No se afirma igualdad exacta entre muestras temporales.

WebKit/iPhone y Pixel son emulaciones sobre esta máquina. Falta comprobar en un
teléfono físico la composición GPU del desenfoque, el teclado real y áreas
seguras de Safari, y VoiceOver/TalkBack. Los endpoints de pruebas están simulados;
se preservan las formas del contrato y los tests de MockBackend.
