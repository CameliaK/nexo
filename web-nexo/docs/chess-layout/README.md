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
