"""Third-person voice for the portfolio owner, checked in code.

The agent's answers and the generated nodes talk about Kirbith in the third
person: "Kirbith", he/him/his, "él" and masculine agreement ("egresado").
Never she/her/ella or feminine forms, never the owner's own first person
(the portfolio texts say "mi internship", "trabajé"), and never "tú" for
him (the visitor is not Kirbith). check() finds violations; fix() rewrites
the mechanical ones (pronouns, possessives, gender, first-person verbs).
What fix() cannot rewrite (e.g. "trabajaste") is left to one regeneration.

Two kinds of text:
- "answer": the agent speaks; its own first person is fine ("te llevé",
  "I created a node"), the owner's is not.
- "node": nobody speaks; any first person is the owner's.
Text inside quotes is skipped: it quotes the visitor ("my AI experience").

"they" is not checked: it has legitimate plural referents (projects,
systems); the prompt asks for "Kirbith" or "he" instead.
"""

import re
from dataclasses import dataclass

_W = r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]"
_QUOTED = re.compile(r'("[^"]*"|“[^”]*”|«[^»]*»)')


@dataclass
class Violation:
    rule: str      # feminine | owner_first_person | tuteo
    text: str      # the offending words
    fixable: bool


def _case(src: str, dst: str) -> str:
    if src.isupper() and len(src) > 1:
        return dst.upper()
    return dst[0].upper() + dst[1:] if src[:1].isupper() else dst


def _segments(text: str) -> list[tuple[str, bool]]:
    """(segment, is_quoted) pieces of text."""
    return [(p, bool(_QUOTED.fullmatch(p))) for p in _QUOTED.split(text) if p]


# ── Spanish ───────────────────────────────────────────────────────────────────

_ES_FEMININE = {
    "ella": "él", "ellas": "ellos", "egresada": "egresado", "titulada": "titulado", "graduada": "graduado",
    "licenciada": "licenciado", "nacida": "nacido", "desarrolladora": "desarrollador",
    "programadora": "programador", "ingeniera": "ingeniero", "diseñadora": "diseñador",
    "creadora": "creador", "autora": "autor", "dueña": "dueño", "becaria": "becario",
    "investigadora": "investigador",
}
_ES_COMMON_GENDER = "estudiante|practicante|pasante|becario|intern"
# Accented word-final é/í that are not first-person preterites.
_ES_NOT_PRETERITE = {
    "también", "después", "través", "inglés", "francés", "japonés", "portugués", "café", "bebé", "comité",
    "josé", "rené", "aquí", "allí", "ahí", "así", "sí", "mí", "país", "raíz", "maíz", "qué", "sé", "dé",
    "esté", "fé", "perú", "colibrí", "frenesí", "rubí", "jabalí", "maniquí", "alhelí", "hindí", "israelí",
}
# The agent's own first person in an answer ("te llevé", "creé un nodo").
_ES_AGENT_PRETERITE = {
    "creé", "llevé", "encontré", "entendí", "busqué", "generé", "revisé", "mostré", "armé", "preparé",
    "añadí", "incluí", "reuní", "junté", "dejé", "agregué", "recuperé", "consulté", "comprobé", "verifiqué",
    "noté", "pensé", "interpreté", "respondí",
}
_ES_AGENT_PARTICIPLE = {
    "creado", "llevado", "encontrado", "generado", "preparado", "reunido", "armado", "incluido", "añadido",
    "buscado", "revisado", "agregado", "recuperado", "entendido", "interpretado",
}
_ES_IRREGULAR = {"hice": "hizo", "fui": "fue", "tuve": "tuvo", "estuve": "estuvo", "pude": "pudo",
                 "quise": "quiso", "supe": "supo", "dije": "dijo", "vine": "vino", "traje": "trajo",
                 "conduje": "condujo", "obtuve": "obtuvo"}
_ES_NODE_PRESENT = {"soy": "es", "estoy": "está", "tengo": "tiene", "yo": "él", "conmigo": "con él"}
# What "tu/tus" may own in an answer: the visitor's own things.
_ES_VISITOR_THINGS = {
    "pregunta", "preguntas", "mensaje", "mensajes", "consulta", "consultas", "solicitud", "petición",
    "pedido", "nodo", "nodos", "idioma", "sesión", "pantalla", "nombre", "correo", "navegador", "duda",
    "dudas", "interés", "visita", "cuenta", "partida", "turno", "respuesta", "chat",
    # "tu nuevo nodo", "tu propio nodo", "tu lista de nodos"
    "nuevo", "nueva", "propio", "propia", "primer", "primera", "lista", "límite", "mapa", "universo",
    "vista", "ventana", "recorrido",
}
_ES_VISITOR_VERBS = {"preguntaste", "pediste", "escribiste", "mencionaste", "dijiste", "quisiste",
                     "buscaste", "solicitaste", "viste", "elegiste", "enviaste", "mandaste"}
# Words with those endings that are not second-person verbs.
_ES_NOT_TUTEO = {"existe", "insiste", "persiste", "consiste", "resiste", "asiste", "chiste", "triste",
                 "despiste", "quiste", "contraste", "desgaste", "engaste", "baste", "claras", "caras", "cámaras",
                 "máscaras", "tiaras", "varas", "jícaras", "fieras", "viste"}


def _es_third_person(verb: str) -> str:
    v = verb.lower()
    if v in _ES_IRREGULAR:
        return _ES_IRREGULAR[v]
    for a, b in (("qué", "có"), ("gué", "gó"), ("cé", "zó"), ("uí", "uyó"), ("eí", "eyó"), ("é", "ó"), ("í", "ió")):
        if v.endswith(a):
            return v[: -len(a)] + b
    return v


def _es_rules(kind: str):
    """(rule, regex, replacement-or-None) for one Spanish text kind."""
    fem = "|".join(_ES_FEMININE)
    rules = [
        ("feminine", rf"\b(la|una)\s+({_ES_COMMON_GENDER})\b",
         lambda m: _case(m.group(1), "el" if m.group(1).lower() == "la" else "un") + " " + m.group(2)),
        ("feminine", rf"\b(la|una)\s+({fem})\b",
         lambda m: _case(m.group(1), "el" if m.group(1).lower() == "la" else "un") + " "
         + _case(m.group(2), _ES_FEMININE[m.group(2).lower()])),
        ("feminine", rf"\b({fem})\b", lambda m: _case(m.group(1), _ES_FEMININE[m.group(1).lower()])),
        ("owner_first_person", r"\b(mi|mis)\b", lambda m: _case(m.group(1), "su" if m.group(1).lower() == "mi" else "sus")),
        ("owner_first_person", r"\bme\s+(gusta|gustan|encanta|encantan|interesa|interesan|apasiona)\b",
         lambda m: _case(m.group(0), "le") + " " + m.group(1)),
        ("owner_first_person", rf"\b({'|'.join(_ES_IRREGULAR)})\b",
         lambda m: _case(m.group(1), _es_third_person(m.group(1)))),
    ]
    agent_part = "|".join(_ES_AGENT_PARTICIPLE)
    if kind == "node":
        rules += [
            ("owner_first_person", rf"\b({'|'.join(_ES_NODE_PRESENT)})\b",
             lambda m: _case(m.group(1), _ES_NODE_PRESENT[m.group(1).lower()])),
            ("owner_first_person", rf"\bhe\s+({_W}+(?:ado|ido))\b", lambda m: _case(m.group(0), "ha") + " " + m.group(1)),
            ("owner_first_person", r"\b(me)\b", lambda m: _case(m.group(1), "le")),
        ]
    else:
        rules.append(("owner_first_person", rf"\bhe\s+(?!(?:{agent_part})\b)({_W}+(?:ado|ido))\b",
                      lambda m: _case(m.group(0), "ha") + " " + m.group(1)))
    # In an answer "tu pregunta" is the visitor's; in a node nothing is.
    visitor_things = _ES_VISITOR_THINGS if kind == "answer" else set()
    visitor_verbs = _ES_VISITOR_VERBS if kind == "answer" else set()
    rules += [
        ("tuteo", rf"\b(tu|tus)\s+({_W}+)\b",
         lambda m: None if m.group(2).lower() in visitor_things
         else _case(m.group(1), "su" if m.group(1).lower() == "tu" else "sus") + " " + m.group(2)),
        ("tuteo", rf"\b({_W}{{2,}}(?:aste|iste|aras|ieras))\b",
         lambda m: None if m.group(1).lower() in visitor_verbs | _ES_NOT_TUTEO else False),
    ]
    # first-person preterite: word-final accented é / í
    rules.append(("owner_first_person", rf"\b({_W}{{2,}}[éí])(?!{_W})",
                  lambda m: None if m.group(1).lower() in _ES_NOT_PRETERITE
                  or (kind == "answer" and m.group(1).lower() in _ES_AGENT_PRETERITE)
                  else _case(m.group(1), _es_third_person(m.group(1)))))
    return rules


# ── English ───────────────────────────────────────────────────────────────────

# What the owner did: "I worked" in an answer is his voice, not the agent's
# (the agent says "I created a node", "I took you there", "I found").
_EN_OWNER_VERBS = {
    # past (same form after "Kirbith")
    **{v: v for v in ("worked", "studied", "developed", "graduated", "trained", "interned", "learned",
                      "practiced", "played", "lived", "led", "implemented", "improved", "joined", "participated",
                      "enjoyed", "competed", "programmed", "coded", "attended", "earned", "was born")},
    # present → third person
    "play": "plays", "live": "lives", "speak": "speaks", "enjoy": "enjoys", "like": "likes", "love": "loves",
    "work": "works", "study": "studies", "train": "trains", "compete": "competes",
}
# In a node nobody speaks: these too are the owner's.
_EN_NODE_VERBS = {**_EN_OWNER_VERBS, **{v: v for v in ("built", "designed", "made", "used", "did", "started",
                                                         "completed", "took", "created", "was")},
                  "am": "is", "have": "has"}
_EN_OWNER_THINGS = {
    "experience", "projects", "project", "work", "internship", "career", "studies", "skills", "background",
    "jobs", "job", "technologies", "tech", "stack", "portfolio", "degree", "hobbies", "education", "training",
    "role", "roles", "university", "languages", "sports", "games", "cv", "resume", "life",
}
_EN_HER_NOT_POSSESSIVE = {"and", "or", "but", "to", "in", "at", "on", "for", "with", "from", "by", "about",
                          "as", "that", "the", "a", "an", "is", "was", "has", "had", "when", "while", "if"}


def _en_her(m: re.Match) -> str:
    nxt = m.group(2)
    return _case(m.group(1), "his" if nxt and nxt.lower() not in _EN_HER_NOT_POSSESSIVE else "him") + m.group(0)[len(m.group(1)):]


def _en_rules(kind: str):
    table = _EN_NODE_VERBS if kind == "node" else _EN_OWNER_VERBS
    verbs = "|".join(sorted(table, key=len, reverse=True))
    rules = [
        ("feminine", r"\b(she)\b", lambda m: _case(m.group(1), "he")),
        ("feminine", r"\b(herself)\b", lambda m: _case(m.group(1), "himself")),
        ("feminine", r"\b(hers)\b", lambda m: _case(m.group(1), "his")),
        ("feminine", r"\b(her)\b(?:\s+([A-Za-z]+))?", _en_her),
        ("owner_first_person", r"\b(my|mine)\b", lambda m: _case(m.group(1), "his")),
        ("owner_first_person", r"\b(myself)\b", lambda m: _case(m.group(1), "himself")),
        ("owner_first_person", rf"\bI\s+({verbs})\b", lambda m: "Kirbith " + table[m.group(1).lower()]),
    ]
    things = "|".join(_EN_OWNER_THINGS)
    rules += [
        ("tuteo", rf"\b(your)\s+({things})\b", lambda m: _case(m.group(1), "his") + " " + m.group(2)),
        ("tuteo", r"\byou\s+(worked|used|studied|built|developed|did|interned|trained|graduated|designed|led|play|played|speak|live)\b",
         lambda m: False),
    ]
    if kind == "node":
        rules += [
            ("tuteo", r"\b(your)\b", lambda m: _case(m.group(1), "his")),
            ("owner_first_person", r"\bI'm\b", lambda m: "Kirbith is"),
            ("owner_first_person", rf"\bI've\s+({_W}+ed|built|led|been|done|made)\b", lambda m: "Kirbith has " + m.group(1)),
            ("owner_first_person", r"\b(I|me)\b", lambda m: "Kirbith" if m.group(1).upper() == "I" else "him"),
        ]
    return rules


# ── API ───────────────────────────────────────────────────────────────────────

def _apply(text: str, lang: str, kind: str, fix: bool) -> tuple[str, list[Violation]]:
    rules = _en_rules(kind) if lang == "en" else _es_rules(kind)
    found: list[Violation] = []
    out = []
    for seg, quoted in _segments(text):
        if quoted:
            out.append(seg)
            continue
        for rule, pattern, repl in rules:
            def sub(m: re.Match) -> str:
                r = repl(m)
                if r is None:          # allowed form
                    return m.group(0)
                found.append(Violation(rule, m.group(0), r is not False))
                return r if (fix and r is not False) else m.group(0)
            seg = re.sub(pattern, sub, seg, flags=re.IGNORECASE)
        out.append(seg)
    return "".join(out), found


def check(text: str, lang: str, kind: str = "answer") -> list[Violation]:
    return _apply(text, lang, kind, fix=False)[1]


def fix(text: str, lang: str, kind: str = "answer") -> str:
    """Rewrites the fixable violations; the unfixable ones are left as is."""
    return _apply(text, lang, kind, fix=True)[0]


def describe(violations: list[Violation]) -> str:
    """For the regeneration feedback: what was wrong, briefly."""
    return "; ".join(dict.fromkeys(f"{v.rule}: «{v.text}»" for v in violations))[:400]


def prompt_rule(lang: str) -> str:
    """The same rule, for the LLM prompts."""
    if lang == "en":
        pron = "he/him/his (never she/her; avoid \"they\")"
    else:
        pron = "él, con concordancia masculina (egresado, desarrollador); nunca ella ni formas femeninas"
    return ("- Habla de Kirbith en tercera persona: por su nombre, y con pronombres solo cuando hagan falta: "
            f"{pron}.\n"
            "- Los textos del portafolio están en primera persona (\"mi internship\", \"trabajé\"): conviértelos a "
            "tercera persona sin cambiar el significado (\"su internship\", \"Kirbith trabajó\").\n"
            "- El visitante no es Kirbith: nunca lo trates de tú al hablar de Kirbith (\"su experiencia\", no "
            "\"tu experiencia\"; \"Kirbith trabajó\", no \"trabajaste\").")
