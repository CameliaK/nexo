# Rendimiento del universo y del ajedrez

Medición del 5 de octubre de 2026, antes de modificar la aplicación y después de
optimizarla. Base: `main` en `f316f23`. Solo se modificó `web-nexo/`.

## Resultados de producción

Chromium 154.0.8037.98, Playwright 1.63.0, macOS arm64, Apple M2 (8 núcleos),
1366 × 768, DPR 2, tres contextos nuevos, 12 nodos generados y sin limitación
artificial de CPU. Navegador headless; no son resultados del servidor de desarrollo.

| Métrica | Antes | Después |
| --- | ---: | ---: |
| Selección legal disponible tras el clic, media | 1651,3 ms | 50,1 ms |
| Apertura más lenta de las tres | 1669,8 ms | 56,1 ms |
| FPS medios durante 5 s de arrastre de cámara | 59,7 | 59,9 |
| Fotogramas perdidos frente a 60 Hz durante 1,8 s de apertura, media | 43 | 20,7 |
| Pérdidas no intencionadas, ajustadas a la cadencia del lienzo | 43 | 0,7 |
| Tareas de más de 50 ms, total de tres aperturas | 5 | 0 |
| Mayor intervalo entre repintados | 61 ms | 34,3 ms |
| Ancho del tablero en la misma escena y cámara | 341 px | 587 px (+72 %) |

Datos completos por repetición: [antes](performance-before.json) y
[después](performance-after.json). Las metas de <250 ms, ausencia de tareas largas
al abrir y >=55 FPS al arrastrar se alcanzaron en esta máquina. No constituyen una
garantía para dispositivos lentos ni para redes que aún tengan que descargar el
módulo o la partida: en esos casos aparece primero el esqueleto y no se bloquea
la navegación. La legalidad depende de tener la posición del servidor.

Los 20,7 fotogramas de la comparación bruta incluyen la reducción deliberada a
30 FPS cuando el tablero está quieto. Durante apertura, movimiento/captura de
piezas y arrastre del tablero se conserva el presupuesto de animación de 60 Hz.
El contador ajustado utiliza la cadencia publicada por el renderizador
(`data-canvas-fps`) en cada repintado: quedaron 0–1 pérdidas por repetición.
Se mantienen ambos contadores para distinguir ahorro de trabajo y tirones.

## Repetir la medición

Desde `web-nexo/`, con Node y Chrome instalados:

```sh
npm ci
npm run build
npm run preview -- --port 4186
```

En otra terminal, también dentro de `web-nexo/`:

```sh
PERF_URL=http://127.0.0.1:4186 PERF_RUNS=3 npm run perf -- docs/performance-results.json
PERF_URL=http://127.0.0.1:4186 npm run test:browser
```

`CHROME_PATH` permite indicar otro ejecutable de Chromium/Chrome; por defecto se
usa `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. Mantener la
misma versión, viewport, DPR, número de repeticiones y carga de otras aplicaciones
para comparar. No ejecutar tests o builds en paralelo con `perf`.

El script `scripts/performance.mjs` sirve el build estático por Vite Preview.
Simula HTTP y WebSocket desde Playwright, una cuenta de jugador con posición
inicial y exactamente 12 nodos válidos. Hace una reconexión de preparación antes
de esperar que se restauren todos los nodos; esa preparación queda fuera de los
intervalos medidos. No requiere ni modifica el backend.

Después de estabilizar la escena, arrastra la cámara a 60 muestras/s durante cinco
segundos. Instrumenta el repintado real del lienzo, no un bucle RAF independiente,
y calcula FPS con sus marcas de tiempo. Registra el clic del nodo de ajedrez,
comprueba que `e2` admite selección y mide hasta ese instante. Observa `longtask`
y los intervalos de repintado en una ventana fija de 1800 ms. Un hueco cuenta como
`max(0, round(intervalo / presupuesto) - 1)`; el contador bruto usa 16,67 ms y el
ajustado usa 16,67 o 33,33 ms. La instrumentación existe solo en los scripts de prueba.

## Hallazgos y cambios

| Hallazgo | Cambio |
| --- | --- |
| La apertura impedía interacción durante los 1550 ms del morph. | Panel y tablero visibles/operables inmediatamente; el despliegue visual continúa aparte durante 1085 ms. Esqueleto visible incluso si falta el chunk o la partida. |
| El módulo y las piezas se cargaban al arrancar. | `chess/lazy.ts` importa el tablero una sola vez, con precarga por pointer intent, foco o tiempo ocioso. El motor compartido de validación sigue disponible para la sesión. |
| Se interpolaban y subdividían miles de triángulos en cada frame de apertura. | Tablero completo más un efecto ligero con los fragmentos originales del nodo; sin subdivisión masiva por frame. |
| Miles de caras se repintaban aunque la posición estuviera quieta. | Raster de tablero/piezas por estado y cámara; caché de caras de casillas, piezas estáticas y picking. Capturas y movimientos conservan sus animaciones. |
| Las 64 casillas se reconstruían al abrir o girar el tablero. | Una construcción; se reposicionan/reordenan los mismos botones, conservando teclado y foco. |
| Cada SVG de capturas/promoción volvía a proyectarse y crear polígonos. | Plantilla cacheada por tipo/color y clonada; las piezas 3D inline se precargan junto al módulo. |
| Se buscaban curvas de media aun sin imágenes y se medían todas las etiquetas cada frame. | Salida temprana sin media, proyección de exclusiones de etiquetas sin lectura de layout y caché de obstáculos fijos de 100 ms, invalidada por resize/idioma. |
| Se dibujaban también nodos fuera del viewport. | Culling conservador del dibujo, conservando objetos, IDs, posiciones, navegación y controles. |
| El nodo de ajedrez usaba left/top para seguir a la cámara. | Movimiento con transform; dimensiones solo cuando cambian escala/radio del hit target. Las posiciones del tablero y sus controles se recalculan solo al cambiar cámara/viewport. |
| Blur de herramientas, media y acceso, y drop-shadow de superficies flotantes sobre un lienzo móvil. | Vidrio más opaco, sin esos filtros. La bienvenida conserva solo blur estático de 3 px, con el universo a 30 FPS detrás. Sombras de pulso no se animan. |
| El universo se renderizaba a pleno ritmo bajo paneles y seguía programando RAF oculto. | 30 FPS con cuenta/acceso/bienvenida o ajedrez quieto; cancelación del RAF oculto y compensación de relojes al volver. Los datos WS siguen actualizándose; una animación creada estando oculto comienza al volver y nunca se desplaza al futuro. |
| El DPR ya estaba limitado a 2 en el universo. | Se conserva y se aplica también al raster del ajedrez. |
| Duraciones dispersas y viajes largos. | `src/motion.ts` comparte duraciones y curvas JS/CSS; principales tiempos un 30 % menores, hover de 150 ms, entradas ease-out y reduced-motion sin efectos decorativos. |
| El selector `div>span` encontraba el avatar. | `.chess-player-info>span` escribe el lado del jugador en su etiqueta; el avatar contiene solo K/V. |

No se añadieron listeners por frame ni logs en rutas calientes. El preload se
cancela al disponer la UI; los listeners de tablero son los mismos entre aperturas.

## Tamaño y adaptación

El objetivo de escritorio es `min(78vh, 70vw, 880px)` para el ancho de la envolvente
3D, ajustado al espacio real de encabezado, jugadores, pie y rail. En la medición
se obtiene 587 px frente a un objetivo de 599 px. La perspectiva de escritorio se
ajusta para aprovechar más ancho sin invadir las etiquetas de jugadores.

En móvil/ventanas compactas todos los hit targets de casillas tienen al menos
44 × 44 px. La superficie visual sigue la proyección 3D: las filas lejanas son más
bajas; en 320 px de ancho o paisaje bajo no caben físicamente ocho casillas planas
de 44 px junto a toda la información. Se conserva la proyección y el picking
geométrico, ampliando las áreas táctiles; el rail permite scroll y las acciones
siguen disponibles. No se fuerza un tablero que cubra los controles.

El rail de escritorio evita también la ventana del sistema y su pie. El nodo de
mensaje utiliza las exclusiones del tablero y de los controles. En pantallas
estrechas se conserva el breadcrumb y se retira el encabezado redundante del
universo mientras se juega; la constelación sigue visible y se restaura al cerrar.

## Validación

`npm test`: 130 pruebas. `npm run build`: TypeScript y producción correctos.
`scripts/chess-browser.mjs` comprueba carga fría con chunk retenido, HTTP retenido,
reutilización de los 64 botones al girar/reabrir, arrastre de pieza, devolución de
foco y avatar/etiqueta separados. Prueba ES/EN en 1366×768, 1920×1080, 900×1000,
390×844, 375×667, 320×568 y 844×390. [Resultados de layout](performance-layouts.json).
Los tests de geometría incluyen zoom 50–200 %; los existentes cubren gestos,
accesibilidad, reglas, nodos del mundo y el panel del dueño.

## Verificación final de contenido y cámara (6 de octubre de 2026)

Compilaciones de producción de `origin/content/final-assets` (`bc5558c`) y
`codex/final-content-camera`, medidas por separado con el mismo script, Chrome
154, Apple M2, 1366 × 768, DPR 2 y 12 nodos restaurados. Tres contextos nuevos por
compilación; ninguna prueba o build se ejecutó durante las mediciones.

| Métrica | Rama de origen | Contenido y cámara final |
| --- | ---: | ---: |
| Selección legal tras el clic, media | 42,3 ms | 43,2 ms |
| FPS medios al arrastrar | 60,2 | 59,9 |
| Pérdidas brutas por apertura, media | 21,0 | 21,0 |
| Pérdidas ajustadas a la cadencia, media | 1,0 | 1,0 |
| Tareas de más de 50 ms en las tres aperturas | 0 | 0 |
| Ancho del tablero | 587 px | 587 px |

Las metas de <250 ms, ≥55 FPS y cero tareas largas se mantienen, sin regresión
observada de fluidez: la variación de 1 ms y 0,3 FPS entre muestras no añade
tareas largas ni fotogramas perdidos. Los valores ligeramente superiores a 60 FPS corresponden
a la ventana finita de muestreo de repintados; no implican una frecuencia de
pantalla distinta. Se conserva el ajuste intencionado a 30 FPS con el tablero quieto.

Resultados por muestra: [origen](performance-final-assets-baseline.json) y
[final](performance-final-content-camera.json). Capturas:
[origen](performance-final-assets-baseline.png) y
[final](performance-final-content-camera.png).

### Precisión del cronómetro

El script heredado iniciaba la comprobación legal después de esperar a que
`locator.click()` y una segunda llamada de Playwright terminasen. Su tiempo
incluía una demora variable de la herramienta, aunque el tablero ya respondiera.
El medidor actual registra el clic y comprueba la primera selección legal con
`requestAnimationFrame` dentro del navegador, antes de devolver el resultado al
proceso de pruebas (`click-capture-raf-legal-selection-v2`). Por eso la comparación
válida es la fila origen/final de esta sección; no se atribuye la diferencia
respecto a los 50,1 ms históricos a una optimización del ajedrez.

Se conservan también las muestras de diagnóstico del medidor anterior:
[origen, tres muestras](performance-final-assets-rpc.json) y
[final, nueve muestras](performance-final-camera-rpc.json). No se mezclan con
los tiempos del cronómetro corregido.

### Cambios revisados

- Formación: 600 ms de fuentes, 800 ms de hilos, 600 ms de wireframe y 400 ms
  de pulso; usa los tokens y la curva de salida existentes. Su reloj se pausa
  durante el regreso automático al nivel 0 y al ocultar la pestaña.
- Enfoque: 900 ms sobre la proyección y el bucle existentes; no hay un segundo
  bucle de animación. Los nodos restaurados no lo disparan, lo que conserva
  la vista al cargar y la preparación del benchmark con 12 nodos.
- El chat conserva una posición legible durante el enfoque; en móvil prioriza
  la respuesta e input, y permite volver a la vista anterior. La interacción
  manual cancela el movimiento y permite continuar el pan desde su posición.
- Imágenes: atributos con dimensiones reales, `contain` en miniatura y visor;
  el visor mantiene su navegación dentro del alto de pantalla. Las etiquetas
  del diagrama reservan tamaños medidos y cacheados; el pan no vuelve a medirlos.
- Se mantienen DPR ≤2, suspensión con pestaña oculta, carga diferida de ajedrez
  y la cadencia de reposo de paneles. No se añadieron filtros o sombras animadas.

Para repetir la versión final, desde `web-nexo/`:

```sh
npm run build
npm run preview -- --port 4192
# En otra terminal, sin otras pruebas o compilaciones concurrentes:
PERF_URL=http://127.0.0.1:4192 PERF_RUNS=3 npm run perf -- docs/performance-results.json
npm run test:forming-browser -- http://127.0.0.1:4192
npm run test:media-browser -- http://127.0.0.1:4192
```

Para comparar otra vez la base, compila `web-nexo/` de `bc5558c` en un directorio
independiente y sírvela en otro puerto. Ejecuta el **script actual** contra ambas
URLs; usar el script antiguo de esa revisión volvería a introducir la demora RPC.


## UI móvil A–F — 2026-10-08

Sobre producción en Apple M2 / Chrome 154, DPR 2 y 12 nodos generados:
43.9 ms hasta interacción, 60.1 FPS en arrastre, 1 fotograma perdido adicional y
0 tareas largas. La base de `mobile-fix` dio 42.2 ms / 60.1 FPS / 1 / 0;
una primera pasada de esta revisión dio 42.1 ms / 60.2 FPS / 1 / 0.
Se conserva el rendimiento dentro de la variación observada entre pasadas.
Resultados y reproducción: [UI móvil](mobile/ui/README.md),
[medición final](mobile/ui/performance.json).
