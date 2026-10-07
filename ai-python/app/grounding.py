"""Source verification for generated nodes, in code.

Every element the LLM puts in a node (tag, list item, timeline entry, metric,
sentence of a text body, and the label and summary) must be supported by the
sources retrieved for this run: facts from knowledge/skills.json and RAG
fragments. Whatever is not supported is dropped. Also dropped, whatever the
sources say, are claims the index rules forbid inferring: years of
experience and proficiency levels. A tech whose only usable evidence is
"mencion" may only appear together with the CV qualifier.

Matching is lexical on purpose (normalized words, 5-letter prefixes so that
plural and gender variants match): it is deterministic, cheap and easy to
audit. It can reject a correct paraphrase — that costs a weaker node, never
an invented one.
"""

import logging
import re
from dataclasses import dataclass, field

from .skills import normalize

log = logging.getLogger(__name__)

MIN_ITEMS = 2          # a list-like node needs at least this many supported items
ITEM_COVERAGE = 0.6    # share of an element's content words found in the sources
TITLE_COVERAGE = 0.5   # label and summary are shorter and more generic

# Function words and the generic vocabulary of a node about someone's skills.
_GENERIC = set("""
a al and as at by con como de del el en entre es esta este estas estos for from ha han has have he his
in is la las lo los mas more o of on or para por que se sobre su sus the this these those to un una uno y
also tambien ademas was were fue han sido been
kirbith cubillas alberto hernandez nodo node nodos nodes
tecnologia tecnologias technology technologies tech herramienta herramientas tool tools
lenguaje lenguajes language languages usado usados usada usadas utilizado utilizados utilizada used uses use
trabajo trabajos work worked proyecto proyectos project projects experiencia experience
resumen summary lista list principales main relevantes relevant algunos algunas some
donde where cuales cual which que what como how cuando when quien who
""".split())

# Claims the index never supports: proficiency levels and years of experience.
_FORBIDDEN = [
    r"\bexpert[oa]s?\b", r"\bexperts?\b", r"\bexpertise\b", r"\bavanzad[oa]s?\b", r"\badvanced\b",
    r"\bsenior\b", r"\bjunior\b", r"\bdomini[oa]\b", r"\bdomina\b", r"\bmaster(y|s|ed)?\b",
    r"\bproficien(t|cy)\b", r"\bintermedi[oa]\b", r"\bintermediate\b", r"\bbasic[oa]?\b",
    r"\banos de experiencia\b", r"\byears? of experience\b", r"\b\d+\s*(anos|years?)\b",
    r"\bnivel\b", r"\blevel\b",
]

# Words of the index's kinds and domains, in both languages, so a label like
# "Lenguajes de frontend" is supported when frontend languages were retrieved.
_KIND_WORDS = {
    "language": "lenguaje language", "framework": "framework", "library": "libreria biblioteca library",
    "tool": "herramienta tool", "database": "base datos database", "platform": "plataforma platform",
    "practice": "practica practice",
}
_DOMAIN_WORDS = {
    "frontend": "frontend front", "backend": "backend back", "mobile": "movil mobile",
    "desktop": "escritorio desktop", "data": "datos data", "ai_ml": "ia ai inteligencia artificial machine learning ml",
    "cloud": "nube cloud", "devops": "devops", "testing": "pruebas testing tests", "design": "diseno design",
}


def _stem(token: str) -> str:
    return token[:5]


def _tokens(text: str) -> list[str]:
    return normalize(text).split()


def _content(text: str) -> list[str]:
    return [t for t in _tokens(text) if t not in _GENERIC and not t.isdigit() and len(t) > 1]


def _numbers(text: str) -> set[str]:
    return set(re.findall(r"\d+(?:[.,]\d+)?", normalize(text)))


@dataclass
class Source:
    ref: str            # portfolio node id
    title: str
    stems: set[str]
    names: set[str]     # normalized tech names/aliases this source is about (skills facts)


@dataclass
class Evidence:
    stems: set[str] = field(default_factory=set)
    text: str = ""
    numbers: set[str] = field(default_factory=set)
    names: set[str] = field(default_factory=set)
    mention_only: set[str] = field(default_factory=set)   # normalized names
    sources: list[Source] = field(default_factory=list)


def build_evidence(hits: list[dict]) -> Evidence:
    """hits: the rag_search hits — RAG fragments and skills facts (source
    "skills", with skill/aliases/kind/domains/level)."""
    ev = Evidence()
    texts = []
    levels_by_name: dict[str, set[str]] = {}
    for h in hits:
        body = f"{h.get('title', '')} {h.get('body', '')}"
        names: set[str] = set()
        if h.get("source") == "skills":
            names = {normalize(n) for n in [h.get("skill", ""), *h.get("aliases", [])] if n}
            body += " " + _KIND_WORDS.get(h.get("kind", ""), "")
            body += " " + " ".join(_DOMAIN_WORDS.get(d, d) for d in h.get("domains", []))
            for n in names:
                levels_by_name.setdefault(n, set()).add(h.get("level", ""))
        texts.append(body)
        stems = {_stem(t) for t in _tokens(body)}
        ev.sources.append(Source(h.get("node_id", ""), h.get("title", ""), stems, names))
        ev.names |= names
    ev.text = " " + normalize(" ".join(texts)) + " "
    ev.stems = {_stem(t) for t in ev.text.split()}
    ev.numbers = _numbers(ev.text)
    ev.mention_only = {n for n, lv in levels_by_name.items() if lv == {"mencion"}}
    return ev


def _names_in(text: str, ev: Evidence) -> set[str]:
    t = " " + normalize(text) + " "
    return {n for n in ev.names if re.search(rf"(?<![a-z0-9+#]){re.escape(n)}(?![a-z0-9+#])", t)}


def _supported(text: str, ev: Evidence, coverage: float, qualify_mentions: bool = True) -> bool:
    norm = normalize(text)
    for p in _FORBIDDEN:
        m = re.search(p, norm)
        # allowed only if the sources say exactly that ("23 años" is the age,
        # not "8 años de experiencia")
        if m and f" {m.group(0)} " not in ev.text:
            return False
    if not _numbers(text) <= ev.numbers:
        return False
    named = _names_in(text, ev)
    # a mention-only tech must carry the CV qualifier ("listado en el CV")
    if qualify_mentions and named & ev.mention_only and not re.search(r"\bcv\b|\bcurriculum\b|\bresume\b", norm):
        return False
    words = [w for w in _content(text) if not any(w in n.split() for n in named)]
    if not words:
        return bool(named) or not _content(text)
    found = sum(_stem(w) in ev.stems for w in words)
    return found / len(words) >= coverage


def _tag_supported(tag: str, ev: Evidence) -> bool:
    n = normalize(tag)
    if n in ev.mention_only:
        return False  # a bare tag cannot carry the CV qualifier
    if n in ev.names or f" {n} " in ev.text:
        return True
    return _supported(tag, ev, 1.0)


@dataclass
class Report:
    kept: int = 0
    dropped: list[str] = field(default_factory=list)


def _verify_content(layout: str, content: dict, ev: Evidence, rep: Report) -> tuple[dict | None, list[str]]:
    """Returns the content with unsupported elements removed (None if nothing
    is left) and the texts that were kept, to attribute sources."""
    kept_texts: list[str] = []

    def keep(text: str, ok: bool) -> bool:
        if ok:
            rep.kept += 1
            kept_texts.append(text)
        else:
            rep.dropped.append(text[:80])
        return ok

    if layout == "tags":
        tags = [t for t in content["tags"] if keep(t, _tag_supported(t, ev))]
        return ({"tags": tags} if len(tags) >= MIN_ITEMS else None), kept_texts
    if layout == "list":
        items = [i for i in content["items"] if keep(i, _supported(i, ev, ITEM_COVERAGE))]
        return ({"items": items} if len(items) >= MIN_ITEMS else None), kept_texts
    if layout == "timeline":
        entries = [e for e in content["entries"]
                   if keep(f"{e['when']}: {e['what']}",
                           _numbers(e["when"]) <= ev.numbers and _supported(e["what"], ev, ITEM_COVERAGE))]
        return ({"entries": entries} if len(entries) >= MIN_ITEMS else None), kept_texts
    if layout == "metrics":
        items = [i for i in content["items"]
                 if keep(f"{i['label']}: {i['value']}",
                         _numbers(i["value"]) <= ev.numbers and _supported(f"{i['label']} {i['value']}", ev, ITEM_COVERAGE))]
        return ({"items": items} if len(items) >= MIN_ITEMS else None), kept_texts
    if layout == "text":
        sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", content["body"]) if s.strip()]
        body = " ".join(s for s in sentences if keep(s, _supported(s, ev, ITEM_COVERAGE)))
        return ({"body": body} if body else None), kept_texts
    return None, kept_texts


def _attribute(texts: list[str], ev: Evidence) -> list[dict]:
    """The sources that actually support the kept elements, by portfolio id:
    for each element, the source(s) with the most words in common — among
    those about the tech it names, if it names one ("C# in the Financial
    Management System" → that project, not every place C# was used)."""
    refs: dict[str, str] = {}
    for text in texts:
        named = _names_in(text, ev)
        stems = {_stem(w) for w in _content(text) if not any(w in n.split() for n in named)}
        pool = [s for s in ev.sources if s.ref and (not named or named & s.names)]
        scored = [(len(stems & s.stems) / max(len(stems), 1), s) for s in pool]
        if not scored:
            continue
        best = max(score for score, _ in scored)
        if not named and best < ITEM_COVERAGE:
            continue
        for score, s in scored:
            if score == best:
                refs.setdefault(s.ref, s.title)
    return [{"title": t, "ref": r} for r, t in refs.items()]


def verify_node(node: dict, ev: Evidence) -> tuple[dict | None, Report]:
    """Drops unsupported elements of a schema-valid node. Returns None when
    what is left is not enough for a node (or its label/summary claim
    something unsupported)."""
    rep = Report()
    # A title names the topic without claiming anything about it, so it does
    # not need the CV qualifier; the summary and the elements do.
    if not (_supported(node["label"], ev, TITLE_COVERAGE, qualify_mentions=False)
            and _supported(node["summary"], ev, TITLE_COVERAGE)):
        rep.dropped.append("label/summary: " + node["label"][:40])
        return None, rep
    content, texts = _verify_content(node["layout"], node["content"], ev, rep)
    if content is None:
        return None, rep
    children = []
    for child in node.get("children", []):
        if not (_supported(child["label"], ev, TITLE_COVERAGE, qualify_mentions=False)
                and _supported(child["summary"], ev, TITLE_COVERAGE)):
            rep.dropped.append("child: " + child["label"][:40])
            continue
        c_content, c_texts = _verify_content(child["layout"], child["content"], ev, rep)
        if c_content is None:
            continue
        child = {**child, "content": c_content}
        child["sources"] = _attribute(c_texts, ev)
        children.append(child)
        texts += c_texts
    sources = _attribute(texts, ev)
    if not sources:
        rep.dropped.append("no source supports the kept elements")
        return None, rep
    return {**node, "content": content, "children": children, "sources": sources}, rep


# A request whose point is a claim the index never records — years of
# experience, an expertise level — cannot be built as asked, whatever the
# sources say: no node (and no LLM call). Narrower than _FORBIDDEN on
# purpose: "nivel de inglés" (B2 is in the portfolio) or "dominio" (also
# "domain") are not such a request.
_UNVERIFIABLE_REQUEST = [
    r"\b\d+\s*(anos|years?)\s+(de\s+experiencia|of\s+experience)\b", r"\banos de experiencia\b",
    r"\byears? of experience\b", r"\bexpert[oa]?s?\b", r"\bexpertise\b", r"\bsenior\b",
    r"\bproficien(t|cy)\b", r"\bmastery\b", r"\bavanzad[oa]s?\b", r"\badvanced\b",
]


def asks_unverifiable(text: str) -> bool:
    norm = normalize(text)
    return any(re.search(p, norm) for p in _UNVERIFIABLE_REQUEST)
