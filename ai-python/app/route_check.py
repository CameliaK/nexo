"""Grounding of route answers (outcome "route"), in code.

A route answer is written from the full content of the nodes the visitor is
taken to (summary, body, items, architecture components, status), the
summaries of their parents (and, for a group node, of its children), the
skills-index evidence of those nodes and of the techs the question names,
and one derived fact: Kirbith's academic status.

Then every risky claim of the answer is checked against that context,
sentence by sentence:
- tech names (skills index names and aliases) must be in the context;
- a tech placed somewhere ("C# en su internship") needs evidence at that
  place (the node or below it) in the skills index or the portfolio;
- degrees, institutions and other proper names, roles, numbers, months and
  durations must be in the context (English through app/lexicon.py);
- temporal status ("sigue", "currently", "still") needs a node whose status
  says so; "still studying" is never supported: Kirbith is a graduate.
A sentence with an unsupported claim is unsupported. Lexical on purpose,
like grounding.py: it may reject a correct paraphrase, never pass an
invented employer, degree or date.
"""

import re
from dataclasses import dataclass, field

from . import lexicon
from .grounding import _numbers
from .rag import _content_text
from .skills import Fact, SkillsIndex, normalize
from .voice import fix as voice_fix

STATUS_WORDING = {
    "actual": "actual: lo sigue haciendo", "en_construccion": "en construcción",
    "practicado": "practicado en el pasado", "favorito": "favorito",
}
_LIVE_STATUS = {"actual", "en_construccion"}

# Places a tech can be attributed to → portfolio subtrees. Labels of the
# experience / learning / project nodes are added automatically.
_PLACE_ALIASES = {
    "internship": ["experiencia.infosys", "aprendizaje.extras"], "intern": ["experiencia.infosys", "aprendizaje.extras"],
    "pasantia": ["experiencia.infosys", "aprendizaje.extras"], "practicas": ["experiencia.infosys", "aprendizaje.extras"],
    "infosys": ["experiencia.infosys", "aprendizaje.extras"], "india": ["experiencia.infosys", "aprendizaje.extras"],
    "dgti": ["experiencia.dgti"], "dest": ["experiencia.dest"], "hermes": ["experiencia.dgti.hermes"],
    "sistema financiero": ["aprendizaje.proyectos-academicos.sistema-financiero"],
    "financial system": ["aprendizaje.proyectos-academicos.sistema-financiero"],
    "credit management": ["aprendizaje.proyectos-academicos.sistema-financiero"],
    "gestion financiera": ["aprendizaje.proyectos-academicos.sistema-financiero"],
    "financial management": ["aprendizaje.proyectos-academicos.sistema-financiero"],
    "gestion de creditos": ["aprendizaje.proyectos-academicos.sistema-financiero"],
    "sistema de creditos": ["aprendizaje.proyectos-academicos.sistema-financiero"],
    "fitness": ["aprendizaje.proyectos-academicos.fitness-app"],
    "juego de cartas": ["aprendizaje.proyectos-academicos.astralis"], "card game": ["aprendizaje.proyectos-academicos.astralis"],
    "correspondencia": ["experiencia.dgti.hermes"], "correspondence": ["experiencia.dgti.hermes"],
    "plataformas educativas": ["experiencia.dest.plataforma"], "educational platforms": ["experiencia.dest.plataforma"],
    "universidad": ["aprendizaje.universidad", "aprendizaje.proyectos-academicos"],
    "university": ["aprendizaje.universidad", "aprendizaje.proyectos-academicos"],
    "uv": ["aprendizaje.universidad", "aprendizaje.proyectos-academicos", "experiencia.dgti", "experiencia.dest"],
    "proyectos academicos": ["aprendizaje.proyectos-academicos"], "academic projects": ["aprendizaje.proyectos-academicos"],
    "proyectos personales": ["proyectos-personales"], "personal projects": ["proyectos-personales"],
    "este portafolio": ["proyectos-personales.este-portafolio"], "this portfolio": ["proyectos-personales.este-portafolio"],
    "este sitio": ["proyectos-personales.este-portafolio"], "this site": ["proyectos-personales.este-portafolio"],
    "buscador industrial": ["experiencia.infosys.buscador"], "industrial tool search": ["experiencia.infosys.buscador"],
    "mantenimiento predictivo": ["experiencia.infosys.digital-twin"], "predictive maintenance": ["experiencia.infosys.digital-twin"],
    "digital twin": ["experiencia.infosys.digital-twin"],
}
_PLACE_ROOTS = ("experiencia.", "aprendizaje.", "proyectos-personales.")

_STUDYING_NOW = re.compile(r"\b(estudiando|cursando|studying|pursuing|enrolled|inscrito"
                           r"|(?:is|es|sigue siendo)(?: both| also| still| todavia| aun| ahora)?(?: an?| un)? (?:student|estudiante)"
                           r"|sigue en la universidad|still at university)\b")
_NEGATION_BEFORE = re.compile(r"\b(ya no|no longer|not|no|nunca|never|isn t|is not)(\s+\w+){0,2}\s*$")
_GRADUATE_OR_NEG = re.compile(r"\b(ya no|no longer|not|no)\b")
_STATUS_MARK = re.compile(r"\b(sigue|siguen|continua|continuan|actualmente|todavia|aun|hoy en dia|en la actualidad"
                          r"|still|currently|nowadays|presently|at the moment|these days|ongoing|at present)\b")
_NEGATED_MARK = re.compile(r"\b(todavia no|aun no|still (don t|do not|doesn t|does not|can t|cannot|haven t|have not))\b")
_CONSTRUCTION = re.compile(r"\b(en construccion|en desarrollo|under construction|in progress|being built)\b")
_DURATION = re.compile(r"\b(\d+|uno|una|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|a|an|one|two"
                       r"|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(anos|ano|meses|mes|semanas"
                       r"|years|year|months|month|weeks)\b")
_DEGREE_SPECIFIC = re.compile(r"\b(ingenieria (?:de|en) [a-z]+(?: de la [a-z]+)?|ciencias de la computacion"
                              r"|sistemas computacionales|licenciatura en [a-z]+|maestria|doctorado|masters?"
                              r"|phd|mba)\b")
_ROLE = re.compile(r"\b(engineer|ingeniero|developer|desarrollador|programador|programmer|intern|pasante|practicante"
                   r"|becario|lead|lider|manager|gerente|jefe|director|analyst|analista|architect|arquitecto"
                   r"|consultant|consultor|scientist|cientifico|cto|ceo|founder|fundador|cofundador|freelancer?"
                   r"|senior|junior)\b")
_ABSENCE = re.compile(r"\b(no hay (ningun )?registro|no tengo (ningun )?registro|no aparece|no encontre|sin registro"
                      r"|no record|no information|isn t in the portfolio|is not in the portfolio|don t have any record"
                      r"|do not have any record|couldn t find|could not find)\b")
_GENERIC_ROLES = {"engineer", "ingeniero", "developer", "desarrollador", "programador", "programmer"}
_INTERN_ROLES = {"intern", "pasante", "practicante", "becario"}
_ROLE_MODIFIERS = {"backend", "frontend", "full", "stack", "fullstack", "mobile", "movil", "data", "datos", "ml",
                   "ai", "ia", "cloud", "devops", "qa"}
# Capitalized words that are not claims: the owner, degree vocabulary, the
# agent's own words. Proper names are checked otherwise.
_NOT_NAMES = {"kirbith", "i", "bachelor", "b.s", "bs", "degree", "node", "nodo", "nodos", "nodes"}


@dataclass
class Context:
    path: list[str]
    ids: set[str]
    text: str                  # normalized corpus, padded with spaces
    numbers: set[str]
    months: set[str]
    facts: list[Fact]
    live: dict[str, str]       # node id → normalized label/keywords of nodes with a live status
    prompt: str
    fallback_label: str
    fallback_summary: str


@dataclass
class Finding:
    sentence: str
    claim: str
    why: str
    hint: str = ""     # what the sources do say, for the regeneration


def node_text(n: dict) -> str:
    parts = [n.get("label", ""), n.get("tagline") or "", n.get("summary", ""), _content_text(n.get("content"))]
    arch = n.get("architecture") or {}
    if arch.get("contribution"):
        parts.append(f"Contribución: {arch['contribution']}")
    for c in arch.get("components") or []:
        parts.append(" ".join(str(c.get(k) or "") for k in ("label", "tech", "what", "contribution")))
    if n.get("status"):
        parts.append(f"Estado: {STATUS_WORDING.get(n['status'], n['status'])}")
    return " ".join(p for p in parts if p)


def _children(nid: str, portfolio: dict) -> list[str]:
    return [k for k, n in portfolio.items() if n.get("parent") == nid]


def _subtree(nid: str, portfolio: dict) -> set[str]:
    out, stack = set(), [nid]
    while stack:
        x = stack.pop()
        if x in out:
            continue
        out.add(x)
        stack += _children(x, portfolio)
    return out


def owner_status(portfolio: dict) -> str:
    """Kirbith's academic status, derived from the degree node's items."""
    for n in portfolio.values():
        items = (n.get("content") or {}).get("items") if isinstance(n.get("content"), dict) else None
        if not isinstance(items, list):
            continue
        facts = {str(i.get("label", "")).lower(): str(i.get("value", "")) for i in items if isinstance(i, dict)}
        if "estatus" in facts and "carrera" in facts:
            return (f"Kirbith es {facts['estatus'].lower()} de {facts['carrera']}, "
                    f"{facts.get('institución', facts.get('institucion', ''))} ({facts.get('periodo', '')}). "
                    "Ya no estudia: terminó la carrera.")
    return ""


def build(path: list[str], portfolio: dict, skills: SkillsIndex, techs: list[str] | None = None) -> Context:
    path = [p for p in path if p in portfolio]
    full = list(path)
    summaries: list[str] = []
    seen = set(full)
    first = portfolio[path[0]] if path else None
    parent = first.get("parent") if first else None
    while parent in portfolio and parent not in seen:          # parents of the route
        summaries.append(parent)
        seen.add(parent)
        parent = portfolio[parent].get("parent")
    for nid in path:                                           # a group node is its children
        if portfolio[nid].get("type") == "group" or not portfolio[nid].get("content"):
            for c in _children(nid, portfolio):
                if c not in seen:
                    summaries.append(c)
                    seen.add(c)
    facts = skills.facts_at(seen)
    named = skills.lookup(techs=[t for t in (techs or []) if t in skills._by_id], domains=[], kinds=[],
                          terms=[t for t in (techs or []) if t not in skills._by_id]).facts
    facts += [f for f in named if f not in facts]
    status = owner_status(portfolio)

    lines = []
    for nid in full:
        n = portfolio[nid]
        lines.append(f"Nodo «{n['label']}» (lo llevaste ahí):\n  {node_text(n)}")
    if summaries:
        lines.append("Nodos relacionados (solo su resumen):")
        lines += [f"  «{portfolio[s]['label']}»: {portfolio[s].get('summary', '')}" for s in summaries]
    if facts:
        lines.append("Evidencias del índice de tecnologías (tecnología: dónde se usó):")
        lines += [f"  {f.text('es', portfolio.get(f.node, {}).get('label', f.node))}" for f in facts]
    if status:
        lines.append(f"Hecho general: {status}")

    corpus_parts = [node_text(portfolio[n]) for n in full]
    corpus_parts += [f"{portfolio[s]['label']} {portfolio[s].get('summary', '')}" for s in summaries]
    corpus_parts += [f"{f.name} {' '.join(f.aliases)} {f.text('es', portfolio.get(f.node, {}).get('label', ''))}"
                     for f in facts]
    corpus_parts.append(status)
    text = " " + lexicon.to_spanish(normalize(" ".join(corpus_parts))) + " "
    tokens = text.split()
    months = {lexicon.MONTHS[t] for i, t in enumerate(tokens) if _is_month(tokens, i)}
    live = {nid: normalize(f"{portfolio[nid]['label']} {' '.join(portfolio[nid].get('keywords') or [])}")
            for nid in seen if portfolio[nid].get("status") in _LIVE_STATUS}
    last = portfolio[path[-1]] if path else {"label": "", "summary": ""}
    return Context(path=path, ids=seen, text=text, numbers=_numbers(text), months=months, facts=facts,
                   live=live, prompt="\n".join(lines), fallback_label=last["label"],
                   fallback_summary=last.get("summary", ""))


# ── Claim checks ──────────────────────────────────────────────────────────────

def _sentences(text: str) -> list[str]:
    return [s for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s.strip()]


def _techs_in(sentence: str, skills: SkillsIndex) -> set[str]:
    """Skill ids named in a sentence. One-word names match with their case
    ("Go", "Node", "REST" are also ordinary words); multiword ones without."""
    found = set()
    for s in skills.skills:
        for name in [s["name"], *s.get("aliases", [])]:
            if " " in name:
                if re.search(rf"(?<![\w+#]){re.escape(normalize(name))}(?![\w+#])", normalize(sentence)):
                    found.add(s["id"])
            elif re.search(rf"(?<![\w+#.]){re.escape(name)}(?![\w+#])", sentence):
                found.add(s["id"])
    return found


def _places_in(norm_es: str, portfolio: dict) -> dict[str, set[str]]:
    """Place mentions in a sentence → the portfolio subtrees each may mean
    ("uv" is the university, DGTI or DEST)."""
    places: dict[str, set[str]] = {}
    for alias, ids in _PLACE_ALIASES.items():
        if re.search(rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])", norm_es):
            places.setdefault(alias, set()).update(i for i in ids if i in portfolio)
    for nid, n in portfolio.items():
        if nid.startswith(_PLACE_ROOTS) and n.get("type") in ("group", "project", "architecture", "system"):
            label = normalize(n["label"].split(":")[0])
            if len(label) > 3 and re.search(rf"(?<![a-z0-9]){re.escape(label)}(?![a-z0-9])", norm_es):
                places.setdefault(label, set()).add(nid)
    # a mention inside a longer one ("dgti" in "dgti uv") is the same place
    return {k: v for k, v in places.items() if v and not any(k != o and k in o for o in places)}


def _tech_supported_at(sid: str, places: set[str], portfolio: dict, skills: SkillsIndex) -> bool:
    s = skills._by_id[sid]
    names = [normalize(n) for n in [s["name"], *s.get("aliases", [])]]
    for p in places:
        sub = _subtree(p, portfolio)
        if any(e["node"] in sub and not e.get("needs_review") for e in s["evidence"]):
            return True
        texts = " " + normalize(" ".join(node_text(portfolio[x]) + " " + " ".join(portfolio[x].get("keywords") or [])
                                         for x in sub)) + " "
        if any(re.search(rf"(?<![a-z0-9+#.]){re.escape(n)}(?![a-z0-9+#])", texts) for n in names):
            return True
    return False


def _is_month(tokens: list[str], i: int) -> bool:
    """A month name, or an abbreviation next to a number ("feb 2025"):
    "may", "mar" and "ago" are also ordinary words."""
    t = tokens[i]
    if t not in lexicon.MONTHS:
        return False
    near_number = any(0 <= j < len(tokens) and tokens[j].isdigit() for j in (i - 1, i + 1, i + 2))
    return near_number or (len(t) > 3 and t not in ("march", "sept"))


def _in_ctx(word: str, ctx: Context) -> bool:
    """A name in the context: literally, through the lexicon, or by its
    5-letter stem ("Academic" ~ "académicos"; "Google" is in none)."""
    w = normalize(word)
    if any(lexicon.in_text(v, ctx.text) for v in {w, w.rstrip("s"), w + "s"} if v):
        return True
    stems = {t[:5] for t in ctx.text.split() if len(t) >= 5}
    return len(w) >= 5 and any(x[:5] in stems for x in lexicon.stems(w) if len(x) >= 5)


def check_sentence(sentence: str, ctx: Context, portfolio: dict, skills: SkillsIndex) -> list[Finding]:
    out: list[Finding] = []
    norm = normalize(sentence)
    es = lexicon.to_spanish(norm)

    def bad(claim: str, why: str, hint: str = "") -> None:
        out.append(Finding(sentence, claim, why, hint))

    def used_at(sid: str) -> str:
        labels = [portfolio[e["node"]]["label"] for e in skills._by_id[sid]["evidence"]
                  if not e.get("needs_review") and e["node"] in portfolio]
        return f"{skills._by_id[sid]['name']} se usó en: {', '.join(dict.fromkeys(labels))}" if labels else ""

    # techs, and techs placed somewhere
    techs = _techs_in(sentence, skills)
    ctx_tech_ids = {f.skill_id for f in ctx.facts}
    for sid in techs:
        s = skills._by_id[sid]
        if sid not in ctx_tech_ids and not _ABSENCE.search(norm) and not any(
                _in_ctx(n, ctx) for n in [s["name"], *s.get("aliases", [])]):
            bad(s["name"], "tecnología que no está en las fuentes")
    # Techs and places named together must cover each other: every tech has
    # evidence at one of the places, and every place backs one of the techs.
    # "C# en su internship y en proyectos académicos" fails (the internship
    # backs nothing); "C# en HERMES y Astralis, con WPF" passes.
    for clause in re.split(r";|\bpero\b|\bbut\b|\bmientras\b|\bwhile\b", es):
        clause_techs = {sid for sid in techs if any(
            re.search(rf"(?<![a-z0-9+#.]){re.escape(normalize(n))}(?![a-z0-9+#])", clause)
            for n in [skills._by_id[sid]["name"], *skills._by_id[sid].get("aliases", [])])}
        mentions = _places_in(clause, portfolio)
        if not clause_techs or not mentions:
            continue
        backed = {(sid, m) for sid in clause_techs for m, nodes in mentions.items()
                  if _tech_supported_at(sid, nodes, portfolio, skills)}
        for sid in clause_techs:
            if not any(t == sid for t, _ in backed):
                bad(f"{skills._by_id[sid]['name']} @ {', '.join(mentions)}", "tecnología atribuida a un lugar sin evidencia ahí",
                    used_at(sid))
        for m in mentions:
            if not any(pm == m for _, pm in backed):
                bad(f"{', '.join(skills._by_id[t]['name'] for t in sorted(clause_techs))} @ {m}",
                    "tecnología atribuida a un lugar sin evidencia ahí",
                    "; ".join(filter(None, (used_at(t) for t in sorted(clause_techs)))))

    # degrees
    for m in _DEGREE_SPECIFIC.finditer(es):
        if f" {m.group(1)} " not in ctx.text:
            bad(m.group(1), "título o carrera que no está en las fuentes")

    # roles
    ctx_has_generic = any(f" {r} " in ctx.text for r in _GENERIC_ROLES | {"intern"})
    es_tokens = es.split()
    for m in _ROLE.finditer(es):
        role = m.group(1)
        at = len(es[: m.start()].split())
        if role in _GENERIC_ROLES and ctx_has_generic:
            pass
        elif role in _INTERN_ROLES and (" intern " in ctx.text or " internship " in ctx.text):
            pass
        elif not _in_ctx(role, ctx):
            bad(role, "cargo que no está en las fuentes")
        for w in es_tokens[max(0, at - 2): at + 3]:
            if w in _ROLE_MODIFIERS and not _in_ctx(w, ctx) and not (w == "full" and " full stack " in ctx.text):
                bad(f"{w} {role}", "cargo que no está en las fuentes")

    # proper names and acronyms (not the first word of the sentence). A
    # sentence that says something is absent ("no hay registro de Rust")
    # claims nothing about it.
    absent = _ABSENCE.search(norm)
    words = [] if absent else [w.rstrip(".") for w in re.findall(r"[\w.+#]+", sentence)]
    for i, w in enumerate(words):
        lw = normalize(w)
        if not lw or lw in _NOT_NAMES or lw in lexicon.MONTHS or w[:1].islower() or not w[:1].isalpha():
            continue
        if i == 0 and not (w.isupper() and len(w) > 1):
            continue
        if any(normalize(n) == lw for s in skills.skills for n in [s["name"], *s.get("aliases", [])]):
            continue  # techs are checked above
        if not _in_ctx(w, ctx):
            bad(w, "nombre propio que no está en las fuentes")

    # numbers, months and durations
    for num in _numbers(norm) - ctx.numbers:
        bad(num, "cifra o fecha que no está en las fuentes")
    tokens = norm.split()
    for i, t in enumerate(tokens):
        if _is_month(tokens, i) and lexicon.MONTHS[t] not in ctx.months:
            bad(t, "mes que no está en las fuentes")
    for m in _DURATION.finditer(norm):
        n = lexicon.NUMBER_WORDS.get(m.group(1), m.group(1))
        unit = m.group(2)
        if not re.search(rf"\b({re.escape(m.group(1))}|{n})\s+{unit}\b", ctx.text):
            bad(m.group(0), "duración que no está en las fuentes")

    # temporal status
    for m in _STUDYING_NOW.finditer(norm):
        if not _NEGATION_BEFORE.search(norm[: m.start()]):
            bad(m.group(0), "estado temporal falso: Kirbith es egresado")
    mark = _STATUS_MARK.search(norm)
    if mark and not _NEGATED_MARK.search(norm) and not _GRADUATE_OR_NEG.search(norm[: mark.start()] + " "):
        words_s = set(es.split())
        if not any(words_s & set(kw.split()) - {"de", "la", "el", "en", "y"} for kw in ctx.live.values()):
            bad(mark.group(0), "estado temporal que las fuentes no dan")
    if _CONSTRUCTION.search(norm) and not any(
            portfolio[n].get("status") == "en_construccion" for n in ctx.ids if n in portfolio):
        bad(_CONSTRUCTION.search(norm).group(0), "estado temporal que las fuentes no dan")
    return out


def verify(answer: str, ctx: Context, portfolio: dict, skills: SkillsIndex) -> list[Finding]:
    found: list[Finding] = []
    for s in _sentences(answer):
        found += check_sentence(s, ctx, portfolio, skills)
    return found


def claims(answer: str, skills: SkillsIndex, portfolio: dict) -> int:
    """How many risky claims the answer makes (for the evaluation's rate)."""
    n = 0
    for s in _sentences(answer):
        norm = normalize(s)
        es = lexicon.to_spanish(norm)
        n += len(_techs_in(s, skills)) + len(_DEGREE_SPECIFIC.findall(es)) + len(_ROLE.findall(es))
        n += len(_numbers(norm)) + len(_DURATION.findall(norm)) + bool(_STATUS_MARK.search(norm))
        n += bool(_STUDYING_NOW.search(norm))
        words = re.findall(r"[\w.+#]+", s)
        n += sum(1 for i, w in enumerate(words) if i > 0 and w[:1].isupper() and normalize(w) not in _NOT_NAMES)
    return n


def strip(answer: str, findings: list[Finding]) -> str:
    bad = {f.sentence for f in findings}
    return " ".join(s for s in _sentences(answer) if s not in bad)


def no_detail(ctx: Context, lang: str) -> str:
    if lang == "en":
        return f"I don't have more verified detail on that; you'll find what there is in “{ctx.fallback_label}”."
    return f"No tengo más detalle verificado sobre eso; lo que hay está en «{ctx.fallback_label}»."


def fallback(ctx: Context, lang: str) -> str:
    """Only the sources' summary and the link to the node."""
    if lang == "en":
        return (f"I took you to “{ctx.fallback_label}”, where you'll find the details. "
                "I don't have more verified detail to add.")
    summary = voice_fix(ctx.fallback_summary, "es", "node").rstrip(".")
    return f"Te llevé a «{ctx.fallback_label}»: {summary}. No tengo más detalle verificado que agregar."


def feedback(findings: list[Finding]) -> str:
    items = "; ".join(dict.fromkeys(f"«{f.claim}» ({f.why}{': ' + f.hint if f.hint else ''})" for f in findings))[:900]
    return ("Tu respuesta anterior afirmaba cosas que las fuentes no respaldan: " + items +
            ". Reescríbela usando SOLO la información de las fuentes; si no tienes un detalle, dilo.\n\n")
