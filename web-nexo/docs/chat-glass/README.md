# Chat de vidrio y ajedrez

El panel recupera el vidrio oscuro del historial anterior a `chat-fix` y
`mobile-ui`: `19e1013` y el padre de `d053100`. La superficie histórica era
`rgba(8,19,26,.56)` con un acento de vidrio verde. Ahora usa alfa **0,64**, blur
**20 px** en escritorio y **16 px** en móvil, saturación **1,1**, borde fino y
prefijo Safari. `src/motion.ts` contiene la transparencia y la escala de capas:
universo 0, etiquetas 5, controles 20, paneles 40, modales 80.

No hay atenuación ni bloqueo global al abrir el chat. La columna normal mide
380 px; en móvil la hoja reserva aproximadamente el 55 % del alto útil.
La geometría de las etiquetas bajo el panel se comprueba con posiciones ya
proyectadas, sin medir cada nodo en cada fotograma. Los controles fijos se miden
solo al abrir, cambiar idioma, redimensionar o cambiar el viewport del teclado.
Los cuerpos y las trazas del universo continúan dibujándose a 60 FPS en nivel 0.

El ajedrez reutiliza las mismas instancias del asistente y chat en vivo, con una
píldora, dos pestañas y su insignia. Un único reloj de 250 ms controla el espacio
reservado, el tablero, la columna y la ventana del sistema. No se reconstruyen
las 64 casillas ni se añade un bucle de animación. El chat se cierra primero con
Escape; el foco vuelve a la píldora. El aviso de un nodo generado durante una
partida conserva la cámara. Se mantienen los relojes de reposo del ajedrez,
la suspensión de pestañas ocultas y el movimiento reducido.

## Verificación reproducible

Desde `web-nexo/`, con Node 24 y los navegadores de Playwright instalados:

```sh
npm test
npm run build
npm run preview -- --port 4196
# Otra terminal; ejecutar secuencialmente, contra producción:
CHAT_URL=http://127.0.0.1:4196 QA_CAPTURE=0 npm run test:live-browser
MOBILE_URL=http://127.0.0.1:4196 QA_CAPTURE=1 npm run test:chat-glass
PERF_URL=http://127.0.0.1:4196 PERF_CAPTURE=0 npm run perf -- docs/chat-glass/performance-standard.json
PERF_URL=http://127.0.0.1:4196 PERF_CHAT_GLASS=1 PERF_CAPTURE=0 npm run perf -- docs/chat-glass/performance.json
PERF_URL=http://127.0.0.1:4196 PERF_CHAT_GLASS=1 PERF_MOBILE=1 PERF_CAPTURE=0 npm run perf -- docs/chat-glass/performance-mobile.json
```

`live-regression/browser-results.json` conserva las pruebas del contrato real:
entrega antes/después de POST, 202 sin confirmación, fallo real y reintento sin
duplicados, historial descendente sin estado, respuestas del dueño, recarga,
reconexión, lectura del historial, scroll al enviar, cuatro líneas y teclado.
Solo cambian las expectativas de presentación que exigían opacidad y bloqueo.

`browser-results.json` cubre Chromium 1440×900, Pixel 7, WebKit iPhone 13
390×844 y escritorio con movimiento reducido. Comprueba alfa, blur, ausencia de
atenuación, pan/zoom y navegación con chat abierto, orden de capas y hit testing
del campo, reflujo sin solapamientos, casillas persistentes, envío durante la
partida, las dos pestañas, aviso de nodo, Escape/foco, insignia y trazas activas.
Son pruebas de navegador con dispositivos emulados, no mediciones de hardware
físico de teléfonos.

El contraste se calcula con los colores CSS efectivos, componiendo las capas
sobre blanco como fondo desfavorable. Mensajes: **13,58:1**; campo: **15,75:1**;
placeholder: **9,61:1**. Superan el mínimo AA de 4,5:1. Las burbujas y el campo
tienen su propio fondo; la legibilidad no depende del color del universo.

Capturas de una corrida final:

- [Ajedrez y chat, escritorio](desktop-chess-chat.png)
- [Chat, iPhone 13 390×844](390x844-chat.png)
- [Nivel 0, columna y universo](level-0-chat.png)

Los archivos de rendimiento incluyen los datos de cada pasada, tareas largas y
el blur aplicado. La tabla comparativa está en [performance.md](../performance.md).
