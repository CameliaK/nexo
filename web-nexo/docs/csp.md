# Inventario y propuesta CSP

Revisión: 2026-10-05. La política **no está activada**. `nginx.conf` contiene una cabecera comentada para ensayar en Report-Only, sin bloquear el sitio.

## Recursos de producción

| Tipo | Recursos y origen | Permiso propuesto |
| --- | --- | --- |
| JavaScript | Entradas `src/main.ts`, `src/privacy/page.ts`; módulos compilados `/assets/*.js`; ajedrez importado de forma diferida; `chess.js` incluido en el bundle. No CDN, scripts inline, `eval`, workers o service workers. El mock y sus escenarios son solo de desarrollo. | `script-src 'self'; script-src-attr 'none'` |
| Hojas de estilo | `/assets/*.css`: universo, auth, bienvenida, media, ajedrez y privacidad. `src/style.css` importa DM Sans y Space Grotesk desde `https://fonts.googleapis.com`. | `style-src 'self' https://fonts.googleapis.com` |
| Estilos de elementos | Posiciones, dimensiones, transformaciones y variables CSS calculadas por universo, media, ajedrez y motion. Se asignan por `element.style`, no por cadenas de código. | Excepción acotada `style-src-attr 'unsafe-inline'`; no se autoriza JavaScript inline ni `<style>` inline. Antes de retirarla, comprobar todos los gestos y tamaños. |
| Fuentes | Google Fonts descarga WOFF/WOFF2 de `https://fonts.gstatic.com`; `/privacidad` usa fuentes del sistema, sin petición externa. | `font-src 'self' https://fonts.gstatic.com` |
| Imágenes | `/favicon.svg`, `/media/<node-id>/*.webp`, tres placeholders en `/media/_placeholder/`; candado SVG como `data:image/svg+xml` en `src/auth/style.css`. Piezas, iconos y nodos son SVG inline o canvas, sin descargas. | `img-src 'self' data:` (la excepción `data:` es solo para imágenes) |
| Conexiones | REST same-origin `/auth/*`, `/api/v1/*`; WebSocket same-host `/ws?ticket=…`. | `connect-src 'self' wss://__PUBLIC_HOST__` |
| Navegación | Enlaces al portafolio, `/privacidad`, LinkedIn, correo, descarga local y redirección a Google por `/auth/google/login`. No iframes ni scripts de Google. | `form-action 'self'`; las navegaciones normales no requieren autorizar esos destinos como scripts/conexiones. |

Los medios del contenido se validan como rutas locales WebP. No hay tracking, analítica, scripts de terceros ni ejecución de texto recibido del backend. Google Fonts sí hace peticiones a terceros: alojar esas dos familias localmente permitiría quitar ambos dominios de la política.

## Cabecera candidata

Reemplazar `__PUBLIC_HOST__` por el host público, sin protocolo ni ruta. Nunca copiarlo literalmente a producción. El `wss:` explícito evita diferencias entre navegadores al interpretar `'self'` para WebSocket. En pruebas HTTP locales, sustituirlo por `ws://127.0.0.1:PUERTO`.

```nginx
add_header Content-Security-Policy-Report-Only "default-src 'none'; script-src 'self'; script-src-attr 'none'; style-src 'self' https://fonts.googleapis.com; style-src-attr 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' wss://__PUBLIC_HOST__; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; manifest-src 'self'" always;
```

No incluye `unsafe-eval`, comodines, `https:` global ni `unsafe-inline` para scripts. El punto por reducir es el estilo por elemento y las fuentes externas; una política con nonce requeriría generar nonces por respuesta, algo que este nginx estático no hace.

## Cómo probar sin imponerla

1. Sustituir el host y descomentar **solo** la cabecera Report-Only en un despliegue de prueba. No cambiar el nombre a `Content-Security-Policy`.
2. Revisar `nginx -t` y las cabeceras de `/`, `/privacidad` y `/privacidad/`. Nginx 1.27 no hereda `add_header` del servidor en una ubicación que declara sus propios `add_header`: para ensayar también en `/media/` y `/health`, repetir allí esta misma cabecera o usar un include común.
3. Con la compilación de producción, revisar Console/Network y eventos `securitypolicyviolation`; recorrer ES/EN, login correo/Google, cuenta, chats, medios, navegación, ajedrez, pan/zoom y móvil. Un Report-Only muestra infracciones y no bloquea recursos. Vite en desarrollo usa HMR y estilos inline: no ampliar la política de producción para acomodarlo.
4. Para recolectar informes fuera del navegador hacen falta un receptor real y `Reporting-Endpoints` + `report-to` (o `report-uri` por compatibilidad). No se inventó un endpoint en el backend. Cuando exista, agregar una cabecera `Reporting-Endpoints: nexo-csp="https://__PUBLIC_HOST__/__CSP_REPORT_PATH__"` y `report-to nexo-csp` a esta política. Los informes pueden contener URLs sensibles: usar un receptor propio que elimine queries y limite conservación; no enviar informes a terceros por defecto.
5. Corregir los reportes y repetir. Activar una política obligatoria queda para una decisión posterior.

Validación local: política candidata inyectada exclusivamente por Playwright como Report-Only sobre los HTML de producción, servidos por nginx. Sin infracciones observadas en privacidad, cuenta y avisos en 1366×768 y 390×844. Esto cubre esos flujos; el recorrido completo del universo y login externo queda descrito arriba para el ensayo de despliegue. La configuración entregada sigue sin activarla.

Referencias: [Report-Only](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy-Report-Only), [style-src-attr y asignación por CSSOM](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/style-src-attr).
