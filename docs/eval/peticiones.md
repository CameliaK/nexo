# Peticiones de nodo: comportamiento del agente — 2026-10-07

Complementa la [calibración del RAG](resultados.md): aquí no se ajusta ningún umbral, se
comprueba **qué decide el agente** ante una petición de nodo y **qué dice**.

- **Casos:** [`peticiones.json`](peticiones.json), 38 en español e inglés:
  - c01–c10: primera persona, experiencia en IA, temas que ya tienen nodo (Infosys,
    HERMES), cruces que sí ameritan un nodo y un rechazo que no puede negar lo que existe;
  - r01–r04, de regresión: Rust y Haskell, y las 3 inyecciones de `preguntas.json`;
  - v01–v08, de voz: primera persona, experiencia, nodos hechos con textos del portafolio
    en primera persona ("Practiqué fútbol") y preguntas que provocan un pronombre ("does
    she", "¿y ella?");
  - g01–g16, de respuestas de ruta: estudios, C#, "¿sigue estudiando?", experiencia,
    proyectos, pasatiempos e idiomas.
- **Script:** [`ai-python/eval/eval_agent.py`](../../ai-python/eval/eval_agent.py).
  - Corre `router.run` con el LLM, n8n, Redis y Postgres reales; solo se salta el gateway.
  - Cada caso usa un visitante desechable, y sus nodos se borran al terminar.
  - Resultado completo: [`peticiones-resultados.json`](peticiones-resultados.json).

```bash
# el agente en marcha debe tener ya el código de la rama (n8n lo llama)
docker compose run --rm --no-deps -e PYTHONPATH=/src \
  -v ./ai-python:/src:ro -v ./docs:/docs:ro -v ./knowledge:/knowledge:ro agent \
  python /src/eval/eval_agent.py > docs/eval/peticiones-resultados.json
```

Cuesta ~85 llamadas al LLM por corrida (2 por ruta o rechazo, 3 por nodo generado, más las
regeneraciones de voz si las hay).

## Qué se comprueba

| Campo | Comprobación |
|---|---|
| `outcome` | El `run.done` es uno de los aceptados. |
| `node` | Con `route`, el último nodo de `route.plan` es el esperado. |
| `first_person` | La respuesta dice "Entendí que te refieres a Kirbith" / "I understood you mean Kirbith". |
| `must_not_deny` | Ninguna oración que nombra el término lo niega ("no tengo registro…", "no information…"). Las dos respuestas erróneas de producción caen en este patrón. |
| `node_must_not_claim` | Un nodo generado no contiene ese texto. Además, todo nodo generado tiene fuentes. |
| voz (todos) | La respuesta y cada texto del nodo pasan `app/voice.py`: Kirbith en tercera persona (he/him/his, él, concordancia masculina), sin she/her/ella ni formas femeninas, sin la primera persona del dueño ("mi internship", "trabajé", "I worked") y sin tutear al visitante sobre Kirbith ("tu experiencia", "trabajaste"). Se cuenta también "they/them/their" (`they`), sin fallar. |

El tono ("con amabilidad") se revisa leyendo las respuestas del JSON.

## Respuestas de ruta fundamentadas (2026-10-07)

Una respuesta de ruta (outcome `route`) inventó datos en producción:
- "Ingeniería de Sistemas" (es Ingeniería de Software);
- "C# en su internship" (fue en HERMES, Astralis y el sistema financiero);
- "sigue estudiando" (es egresado).

Solo recibía el resumen del nodo general.

**Fuentes** ([`app/route_check.py`](../../ai-python/app/route_check.py), `build`):
- el contenido completo de los nodos de la ruta: resumen, cuerpo, elementos, componentes de
  arquitectura (etiqueta, tecnología, descripción, contribución) y estado;
- los resúmenes de los nodos padre y, en un nodo `group`, los de sus hijos;
- las evidencias de `knowledge/skills.json` de esos nodos y de las tecnologías que nombra la
  pregunta, con el nodo de cada una;
- un hecho derivado de los datos: "Kirbith es egresado de Ingeniería de Software…".

El prompt dice que use SOLO eso.

**Verificación por código** (`verify`, oración por oración, sobre la respuesta ya corregida
de voz):

| Afirmación | Regla |
|---|---|
| Tecnología (nombre o alias del índice) | Está en las fuentes. Las de una sola palabra se comparan con mayúsculas ("Go", "Node", "REST"). |
| Tecnología + lugar | Se cubren entre sí: cada tecnología tiene evidencia en alguno de los lugares de la oración y cada lugar respalda alguna. "C# en su internship" falla. |
| Título o carrera | "Ingeniería de X", "ciencias de la computación", maestría, doctorado… aparecen tal cual. |
| Nombres propios y siglas | En las fuentes, literal, por el léxico ES/EN o por raíz. Las oraciones de ausencia ("no hay registro de Rust") no cuentan. |
| Cargos | En las fuentes. "desarrollador"/"ingeniero" valen si hay algún cargo de ingeniería. "líder", "senior", "manager"… deben aparecer tal cual. |
| Cifras, meses y duraciones | En las fuentes. "Seis meses" no se deduce de "feb – ago 2025". |
| Estado temporal | "sigue", "actualmente", "still", "currently" solo con un nodo de estado `actual` o `en construcción` del que habla la oración. "Estudiando", "is a student"… fallan salvo que haya una negación justo antes. |

**Si algo falla:**
1. Se regenera una vez, diciendo qué falló y dónde dicen las fuentes que se usó cada
   tecnología señalada.
2. Si sigue fallando, se quitan esas oraciones y se agrega "No tengo más detalle
   verificado…".
3. Si no queda nada, la respuesta es solo el resumen de las fuentes y el nodo.

En el log queda `route grounding: …`, con la oración.

**Idioma** ([`app/lexicon.py`](../../ai-python/app/lexicon.py)):
- Contiene los equivalentes inglés → español del vocabulario del portafolio, meses y números
  en palabra.
- Lo usan esta verificación y la de nodos (`grounding.py`). Por eso v06 ("Kirbith's sports and
  video games") ahora se genera igual que en español.
- No tiene nombres de tecnologías, años ni niveles. Lo prueba
  `test_lexicon_does_not_loosen_rejections`.

### Antes y después

Mismo juez (`route_check`) para las dos corridas:
- **Antes:** 19 respuestas de ruta con el código de `main`, juzgadas después con
  `eval_agent.py --judge` ([`ruta-antes.json`](ruta-antes.json)).
- **Después:** las 27 respuestas de ruta de la corrida completa.

| | Antes (`main`) | Después |
|---|---|---|
| Afirmaciones de riesgo | 133 | 404 |
| Sin respaldo | **10 (7,5 %)** | **0** |
| Respuestas con alguna sin respaldo | 6 de 19 | 0 de 27 |
| Casos g01–g16 que pasan | 10 de 16 | 15 de 16 |
| Fase de respuesta, p50 / p95 | 1,08 s / 1,42 s | 1,22 s / 1,58 s |

Las 10 de antes son las de producción y sus variantes:
- C# en su internship (g03, g04, v04);
- "sigue estudiando" / "is still studying" / "pursuing" (g05, g06);
- "is both a student" (v07).

El juez no es independiente: es el mismo código que filtra. Por eso los casos g01–g16 llevan
además comprobaciones escritas a mano (`must_contain`, `must_not`, `must_not_together`), y
las respuestas se leyeron.

**Latencia:** en las tres corridas "después", la p95 de la fase de respuesta estuvo entre
1,6 s y 2,6 s. La sube cada regeneración (~1,2 s más). Nunca pasó de 4 s.

**Corrida completa final: 37/38.**
- La voz, v06, las 3 inyecciones y Rust/Haskell están bien.
- **Único fallo — g09** ("¿Qué hizo Kirbith en la DEST?"): la respuesta es correcta (cargo,
  lugar, fechas), pero dice que no hay más detalle. El subnodo «Plataformas educativas
  accesibles con IA» está en sus fuentes. Es una respuesta de menos, no una afirmación
  inventada.
- **Falso positivo conocido:** "Where" en una etiqueta traducida al inglés ("Where and what
  Kirbith studied") se marca como nombre propio. Cuesta una regeneración; la segunda
  respuesta pasó.

## Voz en tercera persona (2026-10-07)

Es una regla de código ([`app/voice.py`](../../ai-python/app/voice.py)), no solo del prompt:
- **Respuestas** ([`router._voiced_answer`](../../ai-python/app/agent/router.py)):
  1. La respuesta se genera completa antes de enviarse (una oración ya enviada no se puede
     retirar) y luego sale en varios `answer.chunk`.
  2. Lo mecánico se corrige en sitio: pronombres, posesivos, género, pretérito de 1.ª a
     3.ª persona.
  3. Si queda algo (p. ej. "trabajaste"), se regenera una vez con la lista de fallos y se
     corrige igual. Lo que aún quede se registra (`voice: … unresolved`) y se envía.
- **Nodos** ([`node_builder.voice_node`](../../ai-python/app/node_builder.py)): misma
  corrección en cada texto, tras la verificación de fuentes. Lo que no se puede corregir
  usa el reintento de diseño que ya existía (no hay llamadas extra). Si sigue, ese
  elemento se descarta, como hace la verificación de fuentes.
- El texto entre comillas (citas de la pregunta) no se revisa. La primera persona del
  agente ("te llevé", "I created a node") está permitida en respuestas; en un nodo,
  cualquier primera persona es la del dueño.
- **"they" no se valida:** tiene referentes plurales legítimos (proyectos, sistemas). El
  prompt pide "Kirbith" o "he".

Corrida del 2026-10-07 (22 casos):
- **Voz:** 22/22. Una respuesta se corrigió en sitio ("estudié" → "estudió"); ninguna
  necesitó regenerarse. `they` = 0 en todas.
- **Total:** 21/22.
- **Fallo — v06** ("Create a node with Kirbith's sports and video games"): `unknown`
  en 2 de 2 corridas. Lo descarta la verificación de fuentes, no la voz. El título en
  inglés ("sports", "video games") no aparece en las fuentes, que están en español, y la
  coincidencia es léxica. La respuesta explica lo que sí encontró y no niega nada. En
  español (v05) sí se genera.
- **Hallazgo fuera de esta regla:** algunas respuestas de ruta (v03, v04, v07) agregan datos
  que no están en el portafolio:
  - "egresado de Ingeniería de Sistemas" (es de Software);
  - "C# en su internship" (fue en HERMES, DGTI);
  - "sigue estudiando" (es egresado).

  La respuesta de ruta solo recibe el resumen del nodo general (p. ej. "Experiencia"). La
  voz es correcta, pero el contenido no.

## Resultado anterior (14 casos): 14/14

| Caso | Pregunta | Resultado |
|---|---|---|
| c01 | Create a node with my AI experience | `generated` "AI and ML Experience" (Infosys, buscador, DEST, digital twin); aclara que es Kirbith |
| c02 | Créame un nodo con mi experiencia en IA | `generated` "Experiencia en IA"; aclara que es Kirbith |
| c03 | What did Kirbith do at Infosys? Create me a node | `route` → Infosys: ya existe, resumen, ofrece el cruce "tecnologías que usó en Infosys" |
| c04 | ¿Qué hizo Kirbith en Infosys? Créame un nodo | igual que c03 |
| c05, c06 | Make a node about the HERMES system / Hazme un nodo de HERMES | `route` → HERMES |
| c07 | Créame un nodo con las tecnologías que usó en Infosys | `generated` (cruce: índice de tecnologías × Infosys) |
| c08 | Create a node with my experience with RAG across my projects and jobs | `generated` (cruce entre proyectos y trabajos) |
| c09 | ¿Cuáles son mis proyectos personales? | `route` → Proyectos personales; aclara que es Kirbith |
| c10 | Créame un nodo con lo que hizo en Infosys usando Rust | `route` → Infosys; dice que no hay registro de Rust, sin negar Infosys |
| r01 | Créame un nodo con su experiencia en Rust y Haskell | `unknown`, amable |
| r02–r04 | las 3 inyecciones | `unknown` |

Antes del cambio (código de `main`, mismo script): c03 creaba un nodo duplicado de Infosys.
En producción, (a) y (b) respondían "no tengo información/registro".

## Decisiones que fija esta evaluación

- **Crear o llevar.** El paso "understand" marca `covered` cuando lo pedido ya es un nodo
  (una empresa, un proyecto). Entonces se lleva al visitante ahí, sin duplicado.
  Una sección raíz entera (p. ej. "Experiencia") no cuenta: resumirla cruza varios nodos.
- **Los rechazos reciben las fuentes.** `rag_search` devuelve los nodos recuperados. Un
  término que no es tecnología pero está en el portafolio (Infosys, HERMES) ya no se reporta
  como "sin registro".
- **Años y niveles.** Una petición de nodo con años de experiencia o nivel de dominio
  ("8 años de experiencia", "expert") no se diseña. Lo decide el código, sin llamar al LLM.
  Antes dependía de que el diseño fallara la verificación; en una corrida previa a esta
  regla, r04 llegó a generar un nodo mínimo de Go.

## Límites

- 14 casos y un LLM no determinista: una corrida no prueba que nunca falle. Repetirla al
  cambiar prompts, el índice o el portafolio.
- `must_not_deny` es léxico: detecta negaciones explícitas, no paráfrasis.
