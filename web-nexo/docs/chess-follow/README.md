# Ajedrez adaptable y seguimiento de Nexo

La columna derecha reserva espacio para jugadas y controles antes de asignar alto
al sistema distante. El sistema se comprime en ventanas bajas y sus geometrías
respetan ambos ejes. El historial conserva scroll propio; si la ventana es muy
baja, la columna entera permite desplazarse para alcanzar todos los controles.
El tablero mantiene su composición al abrir o cerrar el chat.

Dentro del ajedrez solo aparece Chat con Kirbith. El asistente permanece en el
universo, con sus mensajes y borrador conservados. El acceso al sistema en móvil
usa la navegación habitual: repliega el ajedrez y viaja al backend. Se eliminó
la hoja ampliada, sus controles y el comportamiento que atrapaba el foco allí.

Nexo sigue el puntero con un desfase de 48 px y amortiguación continua; ya no
busca zonas libres ni se congela cerca de los otros nodos. Sus áreas de clic
están por debajo de los nodos y controles para que estos reciban el toque.
Solo se detiene al apuntarle directamente para poder activarlo.
Mantenerlo pulsado 550 ms lo ancla abajo a la derecha con viaje/pulso de 600 ms;
otra pulsación lo suelta. La tecla P ofrece la misma acción. Funciona también
con su panel abierto, al cambiar el tamaño y sin animación con movimiento reducido.
No se guarda una preferencia ni se modifica la sesión del backend.

## Validación

- `npm test`: 196 pruebas, incluidas duración del hold, supresión del clic,
  cancelación por movimiento, seguimiento continuo, anclaje y panel abierto.
- `npm run build`: producción compilada.
- `npm run test:chess-follow`: Chromium/WebKit, escritorio y móvil; anclar/soltar,
  prioridad de clic, teclado, tamaños de 900 a 480 px de alto, solo chat en vivo
  y viaje móvil al sistema. [Resultados](results.json).
- `npm run test:chess-layout`: 54 estados con 0/12/80 jugadas, cinco tamaños y
  chat cerrado/abierto. [Geometría](geometry.json).
- `npm run test:chess-morph`: inversión a mitad de apertura, borrador, foco y
  movimiento reducido. [Resultados](morph.json).
- Regresiones del [vidrio/contraste](glass/browser-results.json),
  [mensajes](live/browser-results.json) y [toques/idiomas](mobile/ui-results.json).

[Chromium a 1280×592](chromium-1280x592.png),
[WebKit a 1280×592](webkit-1280x592.png).
Para repetir, sirve producción en 127.0.0.1:4196. La pulsación larga de Chrome
se inyecta con entrada nativa (ratón y CDP táctil); WebKit prueba su temporización
con PointerEvents de DOM y usa toques nativos para navegación. El comportamiento
de pulsación larga en un iPhone físico sigue pendiente de comprobar.

## Rendimiento

`npm run perf`, producción, Apple M2 / Chrome 154, DPR 2 y 12 nodos: tres
pasadas secuenciales con cámara a 60.28 FPS y apertura en
56.1 ms de media, sin tareas largas de más de 50 ms.
[Datos de la medición](performance.json). La emulación no sustituye una prueba
del seguimiento y la pulsación larga en un teléfono físico.
