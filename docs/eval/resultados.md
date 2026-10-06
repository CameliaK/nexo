# Calibración del RAG — 2026-10-06

Decide `RAG_SIMILARITY_THRESHOLD`: cuando una consulta no va por ruta, ¿la base de
conocimiento tiene algo que sirva (ruta `generated`) o no (`unknown`)?

- **Preguntas:** [`preguntas.json`](preguntas.json), 33 en español e inglés: 12 sobre el
  portafolio, 6 peticiones de nodo, 8 fuera de alcance (tarifas, clima, política…),
  4 ambiguas y 3 intentos de inyección.
- **Puntaje de una pregunta:** su similitud coseno máxima contra los 54 fragmentos del RAG,
  construidos por `app.rag.build_fragments` (el mismo texto que guarda la ingesta).
- **Script:** [`ai-python/eval/eval_rag.py`](../../ai-python/eval/eval_rag.py), sin base de
  datos ni LLM. Datos completos (puntaje de cada pregunta y barrido de 0.10 a 0.95 en pasos
  de 0.01): [`resultados.json`](resultados.json).

```bash
docker compose run --rm --no-deps -e PYTHONPATH=/src \
  -v ./ai-python:/src:ro -v ./docs:/docs:ro agent \
  python /src/eval/eval_rag.py > docs/eval/resultados.json
```

## Modelos

| | all-MiniLM-L6-v2 (antes) | paraphrase-multilingual-MiniLM-L12-v2 (ahora) |
|---|---|---|
| Nombre en Hugging Face | `sentence-transformers/all-MiniLM-L6-v2` | `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`, commit `e8f8c211226b` |
| Licencia | Apache-2.0 | Apache-2.0 |
| Dimensión | 384 | **384**: la columna `vector(384)` y el índice HNSW no cambian |
| Idiomas de entrenamiento | inglés | 50, incluidos español e inglés |
| Pesos | 91 MB | 471 MB |

## Resultados

Se probaron dos textos de fragmento: el de antes (`label`, resumen y palabras clave) y el
mismo más el contenido del nodo (`content`), que es lo que guarda ahora la ingesta.

| Modelo | Fragmento | AUC (todas) | AUC (consulta) | Mejor exactitud balanceada (consulta) | En el umbral |
|---|---|---|---|---|---|
| all-MiniLM-L6-v2 | sin contenido | 0.742 | 0.823 | 0.771 | 0.47 |
| all-MiniLM-L6-v2 | con contenido | 0.737 | 0.823 | 0.792 | 0.49–0.52 |
| multilingüe | sin contenido | 0.798 | 0.927 | 0.917 | 0.36–0.38 |
| **multilingüe** | **con contenido** | **0.818** | **0.958** | **0.958** | **0.33–0.37** |

- **Todas:** relevantes (portafolio + peticiones de nodo) contra irrelevantes (fuera de
  alcance + inyecciones). Las ambiguas no entran en el ajuste.
- **Consulta:** portafolio contra fuera de alcance. Es la decisión que toma el umbral; ver
  "Por qué el umbral se ajusta con consulta".

### Por qué fallaba el modelo anterior

all-MiniLM-L6-v2 está entrenado en inglés y puntuaba por **idioma**, no por significado:
- Cualquier frase en español rondaba 0.44–0.50 contra los fragmentos en español, también
  el clima (0.504), la política (0.461) o una receta (0.441).
- Las preguntas relevantes en inglés quedaban en 0.23–0.36.

Con el umbral anterior (0.75) **ninguna** pregunta lo superaba (exactitud balanceada 0.5):
por eso la ruta `generated` casi nunca se activaba. Ningún umbral lo arreglaba: su mejor
punto (0.47) deja fuera a casi todo lo que está en inglés.

Con el multilingüe, lo fuera de alcance baja a 0.09–0.32 y lo relevante en inglés sube
(p08: 0.23 → 0.42; p11: 0.24 → 0.37).

### Elección del umbral: 0.35

Barrido del modelo multilingüe con contenido, población "consulta" (12 portafolio, 8 fuera
de alcance):

| Umbral | Portafolio que pasa (TPR) | Fuera de alcance que pasa (FPR) | Exactitud balanceada |
|---|---|---|---|
| 0.30 | 0.917 | 0.500 | 0.708 |
| 0.33 | 0.917 | 0.000 | **0.958** |
| **0.35** | 0.917 | 0.000 | **0.958** |
| 0.37 | 0.917 | 0.000 | **0.958** |
| 0.40 | 0.833 | 0.000 | 0.917 |
| 0.45 | 0.333 | 0.000 | 0.667 |
| 0.75 | 0.000 | 0.000 | 0.500 |

La mejor exactitud balanceada (0.958) se alcanza en todo el intervalo [0.33, 0.37]. Se elige
su **punto medio, 0.35**, el más alejado de los dos bordes de error:
- El fuera de alcance más alto es 0.323 ("What is your hourly rate…").
- El portafolio más bajo por encima del umbral es 0.371 ("What languages does he speak?").

Único error en 0.35: p09 "Has he worked as a backend engineer?" (0.297). Esa pregunta debe
resolverla la ruta rápida (nodo `experiencia.dgti`), no el RAG.

Sobre la población completa ("todas"), 0.35 da TPR 0.833 y FPR 0.182. Los dos falsos positivos
son las inyecciones i02 (0.42) e i03 (0.44).

### Por qué el umbral se ajusta con "consulta"

- **Peticiones de nodo** (n04 0.30, n06 0.29 quedan bajo el umbral): piden un agregado ("las
  herramientas de testing que ha usado") que ningún fragmento individual contiene. No
  dependen del umbral: la intención `create_node` las manda a la ruta profunda y las
  sustenta el índice `knowledge/skills.json`.
- **Inyecciones** (0.34–0.44): mencionan cosas reales (Kirbith, su experiencia), así que
  ningún umbral de similitud las separa. La defensa es la **verificación de fuentes por
  código**: un nodo solo puede afirmar lo que está en el índice o en los fragmentos
  recuperados.
- **Ambiguas** (0.22–0.39): se reportan, no se ajustan. Las que pasan acaban en una ruta
  profunda sin datos suficientes y el agente lo dice.

## Límites de esta evaluación

- 33 preguntas son poca muestra: un solo cambio mueve la exactitud ~4 puntos. Repetir la
  evaluación al cambiar el contenido del portafolio, el texto de los fragmentos o el modelo,
  y **no cambiar el umbral sin repetirla** (CLAUDE.md).
- El intervalo óptimo es estrecho (0.323 → 0.371). Agregar más preguntas reales del sitio
  ayudará a confirmarlo.
- No se evaluó `ROUTE_CONFIDENCE_THRESHOLD` (0.7): es la confianza que declara el LLM, no una
  similitud. Sigue igual.
