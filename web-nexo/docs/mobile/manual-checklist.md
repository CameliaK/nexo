# Comprobación en un teléfono real

Usar Safari en iPhone y Chrome en Android, en vertical y horizontal, con la
compilación de producción de `codex/mobile-fix`. Repetir en ES y EN. Para probar
sin enviar mensajes al dueño se puede compilar con `VITE_BACKEND=mock`; el panel
de desarrollo ofrece el acceso simulado. Las pruebas de Playwright interceptan
HTTP y WebSocket y no utilizan datos ni credenciales reales.

## Navegación y gestos

1. En el nivel 0 no debe aparecer «Volver» ni quedar su hueco junto al título.
2. Tocar el cuerpo de **cada uno de los cinco nodos principales**. Debe entrar a
   su interior; «Volver» debe aparecer y regresar al nivel 0. Repetir después de
   un pellizco, un arrastre y un cambio de zoom con los botones.
3. Pellizcar con dos dedos y desplazar su punto medio. El zoom y la cámara deben
   seguir los dedos, sin entrar a un nodo. Levantar uno y seguir arrastrando: la
   cámara no debe saltar. Levantar ambos y tocar deliberadamente un nodo: debe entrar.
4. Hacer doble toque, cancelar un gesto saliendo de la app y regresar. La página
   no debe ampliar su escala; el siguiente toque normal debe seguir funcionando.
5. En `/privacidad`, el pellizco sí debe ampliar el texto. No debe haber scroll
   horizontal antes de ampliarlo.

## Ajedrez y sistema

1. Abrir el ajedrez desde su nodo. Durante aproximadamente 1,4 s, la vista se
   acerca, las líneas se separan para formar la cuadrícula y las piezas aparecen.
   Los otros nodos se atenúan progresivamente; la ventana del sistema permanece
   visible y se desplaza hasta su posición de juego.
2. Cerrar a mitad de apertura; abrir y cerrar de nuevo. El tablero debe volver a
   su nodo sin dejar capas invisibles que intercepten toques. Repetir activando
   «Reducir movimiento» en el sistema operativo: debe haber solo un fundido.
3. En vertical comprobar la cabecera, jugadores y turno a la izquierda, ventana
   de cristal a la derecha y tablero debajo. En un teléfono pequeño, el historial
   empieza con contador y última jugada; un toque lo expande. En horizontal la
   ventana debe estar en la columna lateral, libre del tablero.
4. Mover una pieza. La iluminación de la ventana debe seguir los `trace.hop` de
   ajedrez cuando el servidor o el mock envían esos eventos.
5. Tocar la ventana: abre la arquitectura ampliada. Cerrar su hoja debe regresar
   al mismo tablero, turno e historial. Con lector de pantalla, comprobar el título,
   la alternativa textual de los componentes y el foco del botón de cierre.

## Chat, teclado y áreas seguras

1. Recibir un mensaje con el chat cerrado: el botón debe mostrar su indicador.
   Abrir el chat en vivo, escribir y enviar sin cerrar el ajedrez. Cambiar a Nexo
   y repetir. La ventana del sistema conserva su marco y forma, sin convertirse
   en una barra, y permanece libre del tablero y del chat.
2. Con el teclado abierto, revisar el campo y «Enviar», incluida la barra de
   sugerencias de iOS/Android. Probar una respuesta larga y desplazar su historial.
   Cerrar el teclado, girar el teléfono y abrirlo otra vez.
3. Cerrar el chat con su botón, ESC si hay teclado físico, y deslizando su cabecera
   hacia abajo. Cerrar el ajedrez con el chat abierto: ambos deben cerrarse y volver
   los controles del universo.
4. Pedir a Nexo un nodo: mientras se juega debe aparecer «Nodo creado: … · Ver»,
   sin mover la cámara. «Ver» cierra el ajedrez y lleva al nuevo nodo; «Volver»
   recupera la vista anterior.
5. Revisar las muescas, los indicadores de inicio y las barras del navegador al
   mostrarse y ocultarse. Ningún botón debe quedar debajo de ellas. Revisar también
   cuenta, bienvenida, visor de imágenes y el retorno desde privacidad.

## Qué se comprobó automáticamente

- Chromium con ratón, iPhone 13 y Pixel 7 con `hasTouch`/`isMobile`; entrada nativa
  de dos dedos mediante CDP. Navegación positiva desde todos los nodos, regresos,
  rueda, botones, arrastre y doble clic/toque.
- WebKit emulado; sus Pointer Events comprueban el pellizco porque su protocolo
  no ofrece la misma inyección multitáctil que CDP.
- Una sola ventana del sistema y la misma identidad DOM antes y durante la
  partida; tamaño, ausencia de barra, iluminación, expansión, partida conservada,
  chats, aviso de nodo y límites de pantalla. Prueba adicional de viewport visible
  reducido a 320 px para el campo de escritura.

La emulación no confirma el teclado nativo y sus sugerencias, las áreas seguras
físicas, las barras y gestos de Safari/Chrome, VoiceOver/TalkBack en dispositivo,
ni el consumo y rendimiento térmico del teléfono. Esos puntos quedan para esta
comprobación manual.

## Causa de las regresiones

**A:** `#node-targets` se hizo un contenedor recortado con `pointer-events: none`,
pero sus botones no recuperaron `pointer-events: auto`. Los clics y toques reales
caían en `#space`; los tests anteriores activaban controles por teclado o de forma
forzada, y solo verificaban que el pellizco no seleccionara un nodo. El contenedor
sigue dejando pasar el espacio vacío y cada botón recupera su área de impacto.
El cálculo del pellizco se conserva; la supresión táctil se limpia para ratón,
blur y pestaña oculta, y la captura espera movimiento.

**B:** la regla móvil `display: inline-flex` tenía más especificidad que
`button[hidden]`. Ahora el botón oculto y su contenedor no se representan ni
ocupan espacio; el chevron no se sustituye por texto al cambiar de nivel.

Los tiempos y las curvas de C están en `src/motion.ts`; el tablero conserva sus
64 controles y usa capas rasterizadas para separar casillas y piezas. El fondo
desenfocado se prepara una vez por apertura. D recoloca `#system-window`, sus
geometrías y el mismo `TracePlayer`; no monta otro renderizador. Durante las
transiciones se pinta a 60 FPS y durante el juego en reposo a 30 FPS. La pestaña
oculta conserva la pausa existente.

## Repetir las pruebas

```sh
npm test
npm run build
npm run preview -- --port 4196
# En otra terminal, sobre ese build:
npm run test:navigation-browser
npm run test:chess-transition-browser
QA_CAPTURE=0 npm run test:mobile
```

La corrida final de capturas guarda únicamente 390×844 y escritorio. El informe
de rendimiento usa 12 nodos generados y se ejecuta al final sin otras pruebas
concurrentes; los resultados están en `fix/performance.json`.
