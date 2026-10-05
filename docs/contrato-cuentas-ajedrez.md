# Contrato: cuentas, ajedrez y dueño

Fuente de verdad para el backend (gateway Go, agente) y para la interfaz (web-nexo).
Si algo no está claro aquí, se pregunta antes de asumir.

## Reglas generales

- Los invitados siguen funcionando sin cuenta para todo lo anterior (chat con el
  agente y chat en vivo). Solo el ajedrez exige cuenta.
- Errores nuevos: `401 login_required`, `403 forbidden`, `409 not_your_turn`,
  `422 illegal_move`.
- El modo (`guest` / `user` / `owner`) se lee SIEMPRE de los claims del token ya
  validado, nunca del cuerpo, de headers ni de la query.
- Nunca se registran correos completos ni tokens en logs (usar forma enmascarada).

## Auth

```
POST /auth/email/request  { email, lang } -> 202 siempre (no revela si existe)
POST /auth/email/verify   { token } -> { token, visitor_id }   (lo llama la página de confirmación)
GET  /auth/google/login   -> 302 a Google
GET  /auth/google/callback -> 302 a /#/login/done?code=...
POST /auth/exchange       { code } -> { token, visitor_id }
POST /auth/logout
POST /auth/unsubscribe    { token } -> 204
GET  /api/v1/auth/me -> { mode: "guest"|"user"|"owner", email_hint?: "k***@gmail.com" }
```

## Identidad tras iniciar sesión

El token es PASETO v4.local (opaco): el navegador no puede leer nada de él. Por eso
`/auth/email/verify` y `/auth/exchange` devuelven aparte el `visitor_id` canónico de la
cuenta. El navegador lo guarda como su id actual (el que manda en `X-Visitor-Id`).
Nunca va en una URL, no se muestra en pantalla y en los logs solo se registran sus
primeros 8 caracteres.

**Primer inicio de sesión:** `/auth/email/verify` y `/auth/exchange` aceptan, opcional,
`Authorization: Bearer <token de invitado>`. Es la única forma en que el gateway sabe cuál es
el id anónimo actual: si la cuenta es nueva, ese id pasa a ser el canónico y sus datos (nodos
generados, chat en vivo) lo siguen. Si ese id ya es canónico de otra cuenta, o no hay Bearer,
la cuenta nace con un id nuevo. Si la cuenta ya existía, se devuelve su id canónico y el id
anónimo queda intacto (nunca se mezclan datos de dos ids). Un Bearer de user/owner o inválido
se ignora. Como el token de invitado solo vive en memoria, el navegador pide uno nuevo a
`/auth/guest` justo antes de verify/exchange.

## Cuenta (Bearer, mode user|owner)

```
GET/PUT /api/v1/account/notifications  { chess_email: boolean }
DELETE  /api/v1/account -> 204  (borra la cuenta y todos sus datos en cascada)
```

## Ajedrez del jugador (Bearer user|owner; invitado -> 401 login_required)

```
GET  /api/v1/chess/game
POST /api/v1/chess/game { color }
POST /api/v1/chess/game/move { uci }
POST /api/v1/chess/game/resign
```

Todas responden `{ game }`. `GET` devuelve la partida activa o, si no hay, la última
terminada (`{ game: null }` si nunca jugó). Crear con una partida activa propia, o con
`CHESS_MAX_ACTIVE` partidas activas en total, responde `409 busy`. Mover fuera de turno o
sin partida activa: `409 not_your_turn`; abandonar sin partida activa: `400 invalid_request`.
Más de `CHESS_MOVES_PER_HOUR` jugadas por cuenta: `429 rate_limited` con `Retry-After`.

## Dueño (Bearer mode owner; 403 si no)

```
GET  /api/v1/owner/chess/games           -> { games: OwnerChessGame[] }
GET  /api/v1/owner/chess/games/{id}      -> { game }
POST /api/v1/owner/chess/games/{id}/move { uci } -> { game }
POST /api/v1/owner/chess/games/{id}/resign -> { game }
```

Partida inexistente: `404 invalid_request`. Mover fuera de turno o en una partida terminada:
`409 not_your_turn`. El dueño no tiene límite de jugadas por hora. Telegram solo avisa
(`♟ #A3F2 · abrir partida` con `PUBLIC_BASE_URL/#/owner/chess?game=<id>`); nunca recibe jugadas.

## Tipos

```
ChessGame = {
  id, color, fen,
  moves: [{ san, uci, by: "player"|"owner", ts }],
  turn: "player"|"owner",
  status: "active"|"checkmate"|"stalemate"|"draw"|"resigned",
  updated_at
}
OwnerChessGame = ChessGame + { tag: "A3F2", player_hint: "k***@gmail.com" }
```

El `tag` son 4 caracteres derivados de un hash del id de la partida, nunca del correo.

## Eventos WebSocket

```
chess.move   data: { game }  al jugador cuando el dueño mueve (aunque esté inactivo)
owner.chess  data: { game: OwnerChessGame, reason: "new"|"move"|"resign" }
             solo a conexiones owner (canal events:owner)
```

`chess.move` también se publica cuando el dueño abandona. `owner.chess` se publica en cada
cambio (del jugador o del propio dueño, para sincronizar sus pestañas). En ambos el sobre usa
`run_id = game.id` y un `seq` que sigue el número de jugadas; no forman parte de una ejecución.

**Ejecución `chess`.** Cada acción que cambia una partida (crear, mover, abandonar, del
jugador o del dueño) es una ejecución propia, con `run_id` nuevo, en el canal de quien actúa:
`run.start { kind: "chess" }` → `trace.hop`×N (solo componentes y aristas existentes:
gateway→redis, gateway→agent, agent→postgres, agent→redis, agent→n8n, n8n→owner_channel) →
`run.done { outcome: "delivered" }` (actúa el jugador) o `"received"` (actúa el dueño), o
`run.error` con el código del error HTTP. `RunKind` suma `"chess"`.

## PortfolioBackend suma

```
authMe, requestEmailLogin, verifyEmailLogin, startGoogleLogin, exchangeCode,
logout, unsubscribe, getNotifications, setNotifications, deleteAccount,
chessGetGame, chessNewGame, chessMove, chessResign,
ownerChessGames, ownerChessMove, ownerChessResign
```

## Variables de entorno relevantes

```
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URL
OWNER_EMAIL, OWNER_PROVIDERS (default "google"), OWNER_TOKEN_TTL (default 8h)
SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, PUBLIC_BASE_URL
AUTH_EMAIL_PER_HOUR (5), AUTH_EMAIL_PER_IP_HOUR (20)
CHESS_MAX_ACTIVE (5), CHESS_MOVES_PER_HOUR (30), CHESS_EMAIL_COOLDOWN_HOURS (6),
CHESS_NOTIFY_MINUTES (10)
```
