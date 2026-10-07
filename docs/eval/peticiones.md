# Peticiones de nodo: comportamiento del agente — 2026-10-07

Complementa la [calibración del RAG](resultados.md): aquí no se ajusta ningún umbral, se
comprueba **qué decide el agente** ante una petición de nodo y **qué dice**.

- **Casos:** [`peticiones.json`](peticiones.json), 14 en español e inglés:
  - 10 nuevos: primera persona, experiencia en IA, temas que ya tienen nodo (Infosys,
    HERMES), cruces que sí ameritan un nodo y un rechazo que no puede negar lo que existe;
  - 4 de regresión: Rust y Haskell, y las 3 inyecciones de `preguntas.json`.
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

Cuesta ~32 llamadas al LLM por corrida (2 por ruta o rechazo, 3 por nodo generado).

## Qué se comprueba

| Campo | Comprobación |
|---|---|
| `outcome` | El `run.done` es uno de los aceptados. |
| `node` | Con `route`, el último nodo de `route.plan` es el esperado. |
| `first_person` | La respuesta dice "Entendí que te refieres a Kirbith" / "I understood you mean Kirbith". |
| `must_not_deny` | Ninguna oración que nombra el término lo niega ("no tengo registro…", "no information…"). Las dos respuestas erróneas de producción caen en este patrón. |
| `node_must_not_claim` | Un nodo generado no contiene ese texto. Además, todo nodo generado tiene fuentes. |

El tono ("con amabilidad") se revisa leyendo las respuestas del JSON.

## Resultado: 14/14

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
