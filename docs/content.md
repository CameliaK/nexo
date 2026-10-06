# Actualizaciones del contenido

La fuente de contenido en español es `web-nexo/src/data/portfolio-content.es.json`.
Su traducción está en `web-nexo/src/data/portfolio-content.en.json`.
`docs/portfolio-content.json` es una copia exacta del ES; no se edita por separado.
Mientras exista `web-nexo/src/data/portfolio-content.json`, mantener esa copia ES con las mismas actualizaciones.

## Preparar una actualización

1. Trabajar en una rama limpia desde la base acordada. No usar una carpeta con trabajo ajeno pendiente como fuente.
2. Guardar los parches ES/EN en `scripts/content/` con nombres que identifiquen la actualización. Los archivos `content-patch.es.json` y `content-patch.en.json` son el parche 2 del 2026-10-06.
3. Revisar los valores actuales en cada destino antes de sobrescribirlos. Si hay ediciones posteriores o distintas de las esperadas, avisar y resolver el conflicto; no aplicarlas a ciegas. El script **no contiene valores anteriores ni detecta conflictos automáticamente**.
4. Mantener los IDs de nodos, componentes y medios iguales entre idiomas. Este flujo actualiza contenido, no backend ni topología.

Formato:

```json
{
  "updates": [
    {
      "id": "experiencia.dgti.hermes",
      "set": {
        "architecture.components[jsgw].what": "Texto revisado."
      },
      "delete": ["architecture.components[jsgw].needs_review"]
    }
  ]
}
```

Las rutas usan puntos; `[id]` selecciona un elemento de una lista por su ID, no por su posición.
El último segmento no admite `[id]`. El nodo y los segmentos intermedios deben existir;
`set` puede crear el último campo y `delete` permite que ya haya desaparecido.
No modificar `id` mediante el parche. `--dry` muestra las operaciones sin escribir;
no es una comprobación de conflictos ni muestra los valores previos.

## Aplicar y sincronizar

Desde la raíz del repositorio, para el parche incluido:

```sh
node scripts/content/apply-content-patch.mjs web-nexo/src/data/portfolio-content.es.json scripts/content/content-patch.es.json --dry
node scripts/content/apply-content-patch.mjs web-nexo/src/data/portfolio-content.en.json scripts/content/content-patch.en.json --dry

node scripts/content/apply-content-patch.mjs web-nexo/src/data/portfolio-content.es.json scripts/content/content-patch.es.json
node scripts/content/apply-content-patch.mjs web-nexo/src/data/portfolio-content.en.json scripts/content/content-patch.en.json
# Solo mientras exista el archivo ES heredado:
node scripts/content/apply-content-patch.mjs web-nexo/src/data/portfolio-content.json scripts/content/content-patch.es.json
npm --prefix web-nexo run sync-content
```

`sync-content` comprueba que el ES es JSON con una lista de nodos y lo copia a `docs/`
sin alterar sus bytes. Resuelve rutas respecto del propio script y funciona independientemente
del directorio de ejecución. No se ejecuta automáticamente en tests: una desalineación debe fallar.

## Habilidades y validación

Cuando la actualización incluya habilidades, revisar `scripts/content/skills.json` y copiarlo a
`knowledge/skills.json`. Es el archivo entregado para el parche 2; conservar las evidencias y las
marcas `needs_review` tal como se hayan confirmado, sin inventar atribuciones.

```sh
cp scripts/content/skills.json knowledge/skills.json
npm --prefix web-nexo run validate-skills
npm --prefix web-nexo test
npm --prefix web-nexo run build
git diff --check
```

`validate-skills` recorre todos los campos `node` de skills y falla si alguno no corresponde a
un ID de nodo del contenido. También admite `node scripts/content/validate-skills.mjs <contenido> <skills>`.
`npm test` exige paridad de IDs ES/EN/docs (incluidos componentes y medios), identidad exacta
entre docs y ES, la copia ES heredada y referencias válidas en knowledge; prueba también que
el validador rechace un nodo inexistente. Revisar el diff antes de comitear y subir la rama.
