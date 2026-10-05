# Metadatos y bienvenida

`index.html` incluye título y descripción en español para buscadores y clientes
que no ejecutan JavaScript. El título y la descripción visibles se actualizan
con el idioma mediante las claves tipadas `app.documentTitle` y `app.description`
en `src/i18n/es.ts` y `src/i18n/en.ts`. Si cambias estos textos, actualiza también
sus valores iniciales en el HTML, incluidos Open Graph y Twitter Card.

Cuando exista el dominio público, reemplaza en `index.html`:

| Valor pendiente | Dónde aparece | Valor final |
| --- | --- | --- |
| `__PUBLIC_SITE_URL__` | `og:url`, `twitter:url` | URL HTTPS absoluta de la portada, con dominio final. |
| `__SOCIAL_IMAGE_URL__` | `og:image`, `twitter:image` | URL HTTPS absoluta de la imagen para compartir. |

Prepara una imagen de 1200 × 630 px, preferiblemente PNG o WebP, y colócala en
`public/` (por ejemplo, `public/social-card.webp`). Su URL final será
`https://tu-dominio/social-card.webp`. Ajusta también `og:image:alt` y
`twitter:image:alt` si el contenido de la imagen requiere otra descripción.
Los marcadores son deliberados: no hay un dominio ni una imagen publicados aún.
El favicon está en `public/favicon.svg`; `theme-color` usa el fondo del universo.

La bienvenida usa `nexo.welcome.dismissed.v1 = "1"` en `localStorage`.
Entrar, omitir o cerrar con ESC guardan el descarte. El nodo «?» la reabre sin
cambiar la cámara o el nivel. Si el almacenamiento no está disponible, el
descarte se conserva durante la visita actual y el portafolio sigue funcionando.

Para probar otra primera visita, elimina únicamente esa clave en las
herramientas del navegador y recarga. No borres las preferencias de idioma ni
los mensajes o nodos generados del MockBackend.

La pista del primer nodo aparece al cerrar la bienvenida inicial y se retira
con la primera acción (clic, toque, teclado o rueda). Reabrir la guía no repite
la pista. El diálogo permite cambiar ES/EN, atrapa el foco, devuelve el foco al
elemento anterior y mantiene los botones accesibles mientras el texto se
desplaza en pantallas pequeñas. Con movimiento reducido, la entrada y el pulso
se muestran sin animación.
