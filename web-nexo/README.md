# Nexo — Arquitectura viva

Frontend del portafolio de Kirbith Cubillas. Conserva el universo Canvas 2.5D: polígonos translúcidos, partículas, movimiento ambiental y transición reversible de caras entre niveles. El contenido v3 se importa localmente desde `src/data/portfolio-content.json`, sin cambiar sus 54 IDs. Las siete arquitecturas de proyectos muestran todos sus componentes en una sola capa.

## Ejecutar

```sh
npm install
npm run dev
```

Desarrollo: `http://127.0.0.1:4174/`. El valor predeterminado es `VITE_BACKEND=mock`. Para probar el esqueleto sin conexión, añade `VITE_BACKEND=real` a `.env.local` y reinicia el servidor.

```sh
npm test
npm run build
npm run preview
```

La compilación publicada usa siempre `RealBackend`, incluso si el entorno indica mock: no incluye escenarios, respuestas simuladas ni panel de desarrollo. Como el adaptador real es un esqueleto, muestra «Sin conexión» y mantiene el grafo en reposo. No hay código de servidor ni solicitudes HTTP/WebSocket reales.

## Fases implementadas

1. `src/backend/types.ts` es una copia exacta del archivo entregado. `MockBackend` implementa `PortfolioBackend`, reproduce los seis escenarios con pausas acumuladas y reemplaza los marcadores sin interpretar HTML. Modela errores 409/429, conexiones, suscripciones, cancelación de temporizadores y almacenamiento local separado para el mock. La respuesta `live-in` comienza seis segundos después de terminar `live-out` y tiene sus propios IDs de ejecución y mensaje.
2. Los nodos del sistema aparecen pequeños y lejanos en el fondo del mismo universo, sin abertura ni recuadro. Conservan las mallas, rotaciones, colores y conexiones de la vista ampliada, renderizadas en el Canvas. Al entrar, la cámara se acerca a esos mismos nodos y al volver se aleja hasta su posición original. Sus nueve componentes y quince conexiones provienen de `backend-architecture.json`. «Este portafolio» abre el mismo destino. Al volver se restauran nivel, zoom y desplazamiento anteriores.

3. Chat en vivo desde el nodo de contacto: nombre opcional, historial persistente simulado, estados de envío, reintento e insignia de mensajes nuevos cuando está cerrado. La respuesta del propietario ilumina el sistema sin cambiar la cámara.

El nodo del chat busca zonas libres en cada frame: evita las formas y etiquetas del nivel actual, el centro, la ventana al sistema y los controles, también al navegar, hacer zoom o redimensionar. La burbuja muestra un solo mensaje y desaparece a los 5 segundos; pasar el mouse por el nodo o la burbuja pausa ese tiempo. La insignia de mensajes nuevos permanece hasta abrir el panel. Con movimiento reducido, el texto se retira sin animación. Restaurar el historial no vuelve a mostrar previews antiguos.
4. Nexo recibe respuestas por fragmentos, muestra el proceso y recorre rutas válidas de forma continua. Dentro del sistema, espera a volver o a pulsar «Ir ahora». Los nodos generados usan cinco layouts de texto plano, muestran fuentes, se guardan y se pueden descartar. El máximo es **12 nodos en total, incluyendo hijos**, con hasta cuatro hijos por nodo y sin nietos. Aparecen sin conexiones y sobreviven a las transiciones.

El reproductor ordena por ejecución y secuencia, descarta duplicados, conserva tramos solapados e interpreta aristas en ambos sentidos. Activo: luz y partícula; completado: brillo fijo; error: rojo. Incluye navegador → Traefik al enviar y Redis → gateway → navegador al recibir. Los eventos de otras pestañas no se animan, salvo `live_in`, que nunca desplaza la cámara. Los estados finales vuelven al reposo después de unos segundos. Movimiento reducido conserva los cambios de estado sin partículas.

Los recuadros LAB y «Generado para ti» solo aparecen en desarrollo. Los nodos generados conservan su etiqueta y sus fuentes en la versión final. En desarrollo, abre **LAB · ESCENARIOS SIMULADOS**. Hay botones para `route-infosys`, `generated-ia`, `unknown-tarifas`, `error-llm`, `live-out`, `live-in`, `/409` y `/429`. Los escenarios también prueban los chats, el recorrido de cámara y la creación de nodos. Escribe «Infosys», «herramientas», «tarifas» o «error» en Nexo para probar esas respuestas.

## Interacciones del universo

- Selecciona nodos para entrar; vuelve con el breadcrumb, Volver o Esc.
- Arrastra el fondo para mover el espacio; rueda o +/− para cambiar el zoom.
- Nexo sigue al cursor. Su ventana translúcida se arrastra desde la cabecera y sigue el espacio al desplazarlo o hacer zoom. Las flechas también permiten moverla al enfocar su cabecera. Centrar vista permite recuperarla. El campo de mensaje envía preguntas al adaptador simulado durante el desarrollo.
- Los diálogos explican los componentes y las conexiones anotadas. Tab permite acceder también a las conexiones.
- Los datos personales, contactos, métricas y aportaciones usan el JSON local. La fecha de nacimiento no se presenta: solo la edad calculada.

## Ajedrez local

En Inicio, el satélite **AJEDREZ** flota sin conexiones. Sus caras se subdividen para formar un tablero en perspectiva dentro del mismo Canvas del universo. Las casillas tienen grosor y las piezas son sólidos tridimensionales triangulados, con caras translúcidas, iluminación y profundidad. Los nodos se apartan suavemente alrededor de la partida y siguen visibles; pulsarlos repliega el tablero y continúa la exploración. El zoom y desplazamiento del universo también afectan al ajedrez. `CHESS_NODE_VISIBLE` en `src/chess/index.ts` controla su visibilidad para una futura entrada oculta.

La partida es local para dos personas: Visitante lleva blancas y Kirbith negras. Clic o toque para seleccionar y mover, arrastre para llevar una pieza y flechas + Enter para jugar con teclado. Se muestran destinos legales, turno, jaque, capturas y notación algebraica. Puedes girar el tablero y empezar otra partida. Esc cancela una selección o un selector abierto; de lo contrario repliega el tablero. Los controles son pequeños elementos flotantes; no se abre una pantalla ni se oscurece el universo.

`src/chess/game.ts` usa chess.js para validar jugadas, enroque, captura al paso, promoción, jaque mate, ahogado y material insuficiente. Triple repetición y 50 movimientos se reclaman mediante el botón de tablas; también admite anunciar la jugada que cumple la condición. Quíntuple repetición y 75 movimientos terminan automáticamente, con prioridad para el jaque mate. `spatial.ts` construye los sólidos, proyecta sus caras y calcula la selección en perspectiva; `geometry.ts` conserva el área de las caras durante la transformación.

El estado vive en memoria: cerrar y abrir conserva la partida durante esa visita; recargar la página la reinicia. El módulo no usa almacenamiento, red, bots ni adaptadores del backend. Movimiento reducido omite animaciones. `tests/chess.test.ts` se incluye en `npm test`.

## Imágenes flotantes

El campo opcional `media` añade hasta seis ventanitas a la capa final de cualquier nodo. Buscan zonas libres, evitan los diagramas y sus conexiones y tienen un visor con pies de foto, flechas y cierre con ESC. Astralis y NKare incluyen tres imágenes neutras de prueba. Consulta [Preparar imágenes y reemplazar placeholders](docs/media.md) para añadir tus WebP y gestionar la caché de `/media/`.

## Organización

- `src/universe.js`: renderizador existente, navegación y cámara.
- `src/main.ts`: composición de interfaz, adaptador y reconexión progresiva tras una desconexión.
- `src/chat.ts`: chats, proceso, rutas y colección de nodos generados.
- `src/live-satellite.js`: búsqueda de zonas libres y temporizador del preview del chat.
- `src/media.ts` y `media.css`: ventanas de imágenes y visor accesible.
- `src/backend/events.ts` y `generated.ts`: entrega ordenada y validación de nodos.
- `src/backend/`: contrato y adaptadores simulado/real.
- `src/system/traces.ts`: estado y cola de trazas, independientes de la cámara.
- `src/system/window.ts`: entrada accesible al sistema; la representación se dibuja en el universo.
- `src/data/`: archivos de contenido y escenarios proporcionados.
- `tests/`: pruebas de tiempos, errores, persistencia simulada, trazas, navegación, cámara y conservación de facetas.
- `dist/`: compilación estática para publicación privada mediante Sites.

Las fuentes de Google son opcionales. El contenido de texto se importa localmente; las imágenes de `public/media/` se cargan de forma diferida al mostrar sus ventanas.

## Idiomas

El nodo fijo **ES / EN** cambia el idioma conservando cámara, profundidad y paneles abiertos. La preferencia se guarda localmente; el contenido faltante en inglés usa el español. Consulta [Contenido y textos por idioma](docs/i18n.md) para editar los JSON y los catálogos tipados. El chat envía el campo opcional `lang`; MockBackend mantiene sus escenarios.
