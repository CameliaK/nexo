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
