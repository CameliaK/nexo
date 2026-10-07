# Correcciones móviles — 7 de octubre de 2026

Rama `codex/mobile-fix`, desde `origin/main`. Cuatro commits por bloques A–D.
Solo cambia `web-nexo/`; se conservan los IDs públicos y el contrato del backend.

- **A:** se reprodujo en producción con `page.mouse.click` y
  `page.touchscreen.tap`: el área del nodo devolvía `#space` en
  `elementFromPoint`, y el botón tenía `pointer-events: none`. Sus botones ahora
  recuperan el impacto, sin quitar el recorte del contenedor. El cálculo del
  pellizco permanece igual; los toques admiten hasta 8 px y menos de 500 ms, la
  captura espera movimiento, y blur/visibilidad limpian el estado. La entrada
  desde los cinco nodos se prueba antes y después de arrastre, pellizco, rueda,
  botones y doble clic/toque.
- **B:** `hidden` prevalece sobre `display: inline-flex` y también elimina el
  contenedor del botón de volver. El chevron se conserva al actualizar el nivel.
- **C:** una secuencia reversible de 1,4 s acerca la vista, separa las aristas,
  forma las 128 caras superiores de la cuadrícula y funde las piezas. Las capas
  de tablero/piezas se cachean; el fondo desenfocado se prepara una vez a
  resolución CSS, sin bajar la resolución de las piezas. El mismo componente
  del sistema se recoloca con FLIP por `transform`. Transición a 60 FPS, reposo
  a 30 FPS, pausa con pestaña oculta y fundido con movimiento reducido.
- **D:** misma ventana de cristal en nivel 0 y ajedrez, sin barra. Mide 138×88 px
  y 118,7×75,7 px con chat. La topología compacta conserva las ramas y se comparte
  entre ambos lugares; la arquitectura ampliada y los saltos usan el mismo
  renderizador. En vertical quedan jugadores/turno a la izquierda, ventana a la
  derecha y tablero debajo. En horizontal ocupa la columna lateral. A 360×640
  el historial inicia como una línea ampliable; con chat se oculta el bloque de
  historial/controles para que no tape el tablero, conservando jugadores y turno.

## Validación

`npm test`: **175/175**. `npm run build`: correcto. Chromium con iPhone 13,
Pixel 7, vertical/horizontal y 360×640; WebKit a 390×844, 844×390 y 360×640,
en ES/EN. [Resultados táctiles](results.json), [WebKit](webkit-results.json).

También pasan los 14 casos ES/EN de escritorio/tablero, módulo frío, backend
retenido, drag, foco y las 64 casillas persistentes; formación/cámara con
movimiento reducido; imágenes altas/anchas; privacidad y borrado. Las pruebas
positivas de navegación y de transición se ejecutaron contra producción.
Las pruebas específicas de D verifican identidad DOM, una sola ventana, tamaño,
ausencia de barra, iluminación de `trace.hop`, expansión y partida conservada.
El chat se comprueba con su bloque de controles oculto, turno visible y teclado
simulado mediante altura visible de 320 px.

## Rendimiento

Chrome 154.0.8037.98, Apple M2, 8 núcleos, DPR 2, 1366×768, 12 nodos generados.
Tres contextos, build de producción, sin otras pruebas concurrentes. No se
repitió la rama de referencia; se compara con el informe guardado de mobile-polish.

| Métrica | Referencia guardada | Corrección final |
| --- | ---: | ---: |
| Interacción tras clic | 44,1 ms | 42,2 ms |
| FPS de cámara | 60,1 | 60,1 |
| Fotogramas inesperados perdidos | 1,0 | 1,0 |
| Tareas >50 ms | 0 | 0 |

[Datos finales](performance.json), [referencia](../performance.json).
Los fotogramas perdidos se ajustan al presupuesto de 60/30 FPS; el cambio de
duración de apertura modifica cuántos fotogramas se reducen deliberadamente.

La [primera medición de esta corrección](performance-initial.json) tuvo una
tarea de 68 ms, 69,4 ms de interacción y 58,2 FPS medios. Para reducir el trabajo
de apertura se bajaron las dos imágenes del fondo de DPR 2 a resolución CSS
(cuatro veces menos píxeles). Se repitió únicamente la medición tras esa
corrección; los tres contextos finales tuvieron cero tareas largas. No se
descartó el resultado inicial.

## Capturas y comprobación física

Una corrida a 390×844 y escritorio; se corrigió únicamente la captura del chat
cuando la revisión visual detectó que una regla de mayor especificidad mantenía
visible el bloque de controles sobre el tablero. Se agregó la aserción faltante.

- Móvil: [universo](390x844-universe.png), [formación](390x844-unfolding.png),
  [tablero](390x844-chess.png), [sistema](390x844-system.png), [chat](390x844-chat.png).
- Escritorio: [universo](desktop-universe.png), [formación](desktop-unfolding.png),
  [tablero](desktop-chess.png).

[Lista para teléfonos reales](../manual-checklist.md). Quedan por confirmar el
teclado nativo y sus sugerencias, muescas, barras y gestos del navegador,
VoiceOver/TalkBack, consumo y rendimiento térmico en dispositivo.
