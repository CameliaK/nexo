# Imágenes en el universo

Cada nodo de `src/data/portfolio-content.es.json` y su equivalente `.en.json` puede incluir el campo opcional `media` al mismo nivel que `id`, `type` y `content`. No cambies el ID del nodo para añadir imágenes.

```json
"media": [
  {
    "id": "vista-general-v1",
    "src": "/media/aprendizaje.proyectos-academicos.astralis/vista-general-v1.webp",
    "alt": "Pantalla de una partida de Astralis con las cartas y el turno actual.",
    "caption": "Vista general del tablero durante una partida.",
    "width": 1600,
    "height": 1078
  }
]
```

- `id`: identificador único de la imagen dentro del nodo.
- `src`: ruta local `/media/<node-id>/<archivo>.webp`. El archivo se coloca en `public/media/<node-id>/`; `public` no aparece en la URL.
- `alt`: obligatorio, descriptivo y sin depender del pie de foto. Explica lo relevante de la imagen para quien no pueda verla.
- `caption`: opcional. Se muestra al pasar el mouse, al enfocar la ventana con el teclado y en el visor ampliado. En pantallas táctiles se muestra directamente.
- `width` y `height`: dimensiones originales en píxeles, enteros positivos. Se conservan en los atributos de la ventanita y del visor para reservar espacio antes de cargar.

## Preparación

Exporta en **WebP**, con un máximo de **1600 px de ancho** y un peso aproximado de **250 KB o menos** por imagen. Mantén la proporción original. Evita datos personales en capturas y revisa su legibilidad al reducirlas. Las ventanitas reservan un marco compacto de proporción 3:2. Tanto ellas como el visor usan `object-fit: contain`: las capturas muy altas o anchas se muestran completas, con espacio libre alrededor. El visor se ajusta al alto disponible, con el pie desplazable si hace falta.

Con las herramientas de WebP instaladas, por ejemplo:

```sh
cwebp -resize 1600 0 -q 80 captura.png -o vista-general-v1.webp
```

Usa el redimensionamiento solo para imágenes más anchas de 1600 px: no amplíes archivos pequeños. Ajusta la calidad para acercarte al presupuesto de peso sin perder detalle.

`nginx.conf` sirve `/media/` con caché pública de un año e `immutable`. **Cambia el nombre del archivo al reemplazarlo** (`vista-general-v2.webp`) y actualiza `src`; reutilizar la misma URL puede dejar la imagen anterior en la caché. Los archivos inexistentes devuelven 404 y no la página de la aplicación.

## Aparición y navegación

Las arquitecturas muestran sus imágenes al entrar en su capa final. Los nodos simples, incluidos proyectos, las muestran al abrir su contenido. Volver o cerrar el contenido retira las imágenes de ese nodo. Se admiten hasta **6 ventanas** por nodo; las entradas adicionales se omiten.

Las ventanas buscan huecos libres alrededor de componentes, etiquetas, conexiones, paneles y controles. Se vuelven más pequeñas cuando falta espacio (hasta 72 × 48 px en móvil, conservando un área de toque de al menos 44 px) y se ocultan mientras no haya una zona libre; el visor permite recorrer también imágenes cuya miniatura no quepa. Las imágenes se solicitan al colocar su ventana, con carga diferida, `width` y `height` explícitos. Si una imagen falla, se retira y el visor la omite. Con `prefers-reduced-motion` no hay deriva ni transiciones.

Haz clic en una ventana para ampliar. Usa los botones o las flechas izquierda/derecha para recorrer las imágenes del nodo. ESC, el botón de cierre o un clic fuera cierran el visor y devuelven el foco. El visor no cambia el nivel ni la cámara.

## Imágenes reales y pruebas

Los src del parche 5 coinciden con `public/media/<node-id>/`. Hay capturas de 395 × 1600, 329 × 1600 y 1600 × 1078. Los antiguos WebP neutros viven únicamente en `tests/fixtures/media/`; no se publican ni se referencian desde el contenido.

## Comprobación en navegador

Con `npm run build` y un preview en el puerto 4192, ejecuta `npm run test:media-browser -- http://127.0.0.1:4192`. Carga los archivos reales y comprueba atributos/intrínsecos de las capturas altas y anchas, `contain`, flechas y límites del visor en escritorio, móvil vertical y ventana baja. Las etiquetas del diagrama reservan su tamaño medido y cacheado, sin mediciones nuevas al hacer pan.
