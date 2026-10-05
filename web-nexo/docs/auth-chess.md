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
