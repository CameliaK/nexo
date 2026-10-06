# Privacidad, tickets y borrado local

`/privacidad` y `/privacidad/` sirven `dist/privacidad/index.html` por nginx. Es una entrada HTML independiente, sin hash, universo ni conexión WebSocket. Usa el idioma persistido del sitio, permite alternar ES/EN y conserva la preferencia al regresar.

`src/data/privacy-notice.json` contiene las dos versiones del documento `docs/aviso-de-privacidad.md` del repositorio (snapshot de main, 2026-10-05), hasta los avisos breves. Al actualizar el documento fuente, actualizar este snapshot. Se muestran literalmente todos los marcadores entre corchetes, incluido el texto pendiente del borrador, como se solicitó. Los tres avisos breves están en el catálogo tipado `src/i18n/es.ts` y `en.ts`, con enlaces reales `/privacidad`.

“Borrar mis datos” pide confirmación en privacidad y Mi cuenta. Solo tras `DELETE /api/v1/session/data` → 204 se eliminan el visitor_id, tokens y datos personales locales del chat; se desconecta el transporte y se recarga la página. No llama a borrar cuenta ni borra partidas: el endpoint solo elimina nodos, mensajes y sesión del visitante. El navegador vuelve como invitado. Se conservan idioma, bienvenida y la espera por IP de `/auth/guest`. Ante 429 no se elimina ninguna credencial, y el botón espera los segundos indicados por Retry-After. La eliminación de cuenta existente sigue siendo una operación separada.

Antes de cada conexión, RealBackend solicita `POST /api/v1/ws-ticket` con Bearer y consume `{ ticket, expires_in: 30 }` inmediatamente en `/ws?ticket=…`. No persiste ni registra tickets o tokens y no usa `?token=`. Cada reconexión obtiene un nuevo ticket, con espera creciente y 429 separado del límite de adquisición de tokens de invitado. Un 401 de invitado renueva el token una vez; las peticiones concurrentes comparten la adquisición del token y la conexión pendiente. MockBackend modela tickets efímeros de un solo uso y conserva su funcionamiento sin red.

El access_log de web usa `$request_method $uri $server_protocol`; omite query y Referer. Esta protección cubre este nginx, no configura proxies o gateways externos.

Validación:

```sh
npm test
npm run build
npm run test:privacy-browser -- http://127.0.0.1:4187
```

Para la última prueba, arrancar primero `npm run preview -- --port 4187`; utiliza producción y fetch/WebSocket simulados, nunca datos reales.
