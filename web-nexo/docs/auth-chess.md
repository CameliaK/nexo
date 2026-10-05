# Acceso y ajedrez en el cliente

Todo el transporte pasa por `PortfolioBackend`. Los nodos del contenido público
mantienen sus IDs; `private_owner_panel`, la constelación y sus partidas existen
solo en memoria y solo se presentan cuando `authMe` devuelve `mode: "owner"`.
Se muestran hasta seis partidas por página (cuatro en móvil).

## Contrato

El color del jugador usa la notación FEN: `"w"` o `"b"`. Las respuestas de partidas
admiten tanto `ChessGame` como `{ game: ChessGame }`; GET sin partida debe devolver
`null`, `{ game: null }` o 204. Un 404/503 significa que la función todavía no está
disponible y presenta «Disponible pronto».

Las respuestas de verify/exchange traen `{ token, visitor_id }`; ese `visitor_id`
(solo del cuerpo) reemplaza `nexo.visitor_id` inmediatamente. El token PASETO local
es opaco y nunca se decodifica. Antes de verify/exchange se pide un token de invitado
fresco y se envía como `Authorization: Bearer`, para que los datos anónimos sigan a
la cuenta en el primer inicio de sesión. Las capacidades se determinan
con `authMe`, nunca con un campo leído del token. La sesión se conserva con
localStorage; si está bloqueado, funciona durante la sesión actual.

`#/login/confirm?t=...` verifica únicamente con el botón de confirmación.
`#/login/done?code=...` intercambia el código al entrar. `#/auth/unsubscribe?token=...`
y `#/unsubscribe?t=...` requieren confirmar la baja de avisos. Tras acceder se
eliminan los parámetros sensibles del hash. Cerrar sesión crea una identidad
invitada nueva y limpia la información de la cuenta anterior de la interfaz.

Los eventos `chess.move` y `owner.chess` no necesitan un `run_id` de chat para
procesarse. Nunca mueven la cámara. Una jugada optimista rechazada se revierte;
409/422 además vuelven a consultar la posición confirmada. El indicador persiste
hasta abrir el tablero del jugador.

## Prueba local

En desarrollo con `VITE_BACKEND=mock`, solicita un enlace y pulsa «Abrir enlace
simulado» (también disponible dentro del panel de acceso). El enlace no inicia la
sesión hasta confirmar. «Google simulado» prueba el intercambio por código.
«Modo dueño» muestra las partidas de ejemplo; al apagarlo vuelve al modo anterior.
«Simular jugada de Kirbith» genera una jugada legal y su evento, incluso con el
panel cerrado. Ninguna de estas herramientas se incluye en producción.

La cuenta permite modificar los avisos, cerrar sesión y confirmar su eliminación.
El mock guarda sesión, partida y preferencias para comprobar una recarga.


## Mi cuenta y acceso

El nodo fijo «Mi cuenta» / «Account» está junto a idioma y ayuda. Para invitados
abre el acceso; para usuarios muestra correo enmascarado, avisos y cierre de sesión,
con confirmación antes de borrar la cuenta. Las preferencias y sus errores son
independientes de la disponibilidad del ajedrez. El tablero solo incluye la línea
de sesión y un enlace a Mi cuenta.

Después del enlace o Google, el acceso se cierra y aparece un aviso breve. Si se
inició desde el candado, abre el ajedrez, incluido su estado «Disponible pronto».
La intención se guarda durante 15 minutos en `nexo.login.continue` para sobrevivir
al redireccionamiento o al enlace en otra pestaña; se consume una sola vez.

## Nodos y errores de chat

Ajedrez, Mi panel y los nodos generados tienen posiciones en el mundo. Las zonas
libres se calculan al cambiar contenido, idioma o tamaño; el pan y zoom (50–200 %)
solo proyectan esas posiciones y sus etiquetas. Ajedrez y Mi panel tienen prioridad
en la franja inferior; cuando hay muchos nodos, el mundo se extiende hacia abajo
y se llega a los restantes con pan, sin forzar solapamientos. La deriva se detiene
con movimiento reducido. El chat en vivo sigue reservando un espacio libre sobre
la proyección del mundo y mantiene su posición durante hover/foco.

Los errores de chat se traducen por código (`busy`, `rate_limited`,
`llm_unavailable`, `internal`), sin publicar el mensaje interno del servidor.
Un 409 se presenta como consulta en curso. Cada chat tiene su propio enfriamiento;
los 429 respetan `Retry-After`. Un `run.error` con `retryable: false` no ofrece
reintento, incluso cuando el WS llega antes de la aceptación HTTP.
