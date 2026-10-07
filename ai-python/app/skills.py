"""Structured skills index (knowledge/skills.json), consulted before the RAG.

The index rules (meta.rules) are applied here, in code:
- evidence with needs_review=true is never asserted: it is dropped;
- level "mencion" is worded as "listed in the CV, no associated project",
  never as mastery;
- no years of experience and no proficiency levels are produced: the only
  facts are tech name, kind, domains, level, the portfolio node and its note.
"""

import json
import logging
import re
import unicodedata
from dataclasses import dataclass, field

log = logging.getLogger(__name__)

LEVEL_WORDING = {
    "es": {
        "experiencia": "usado en un trabajo o prácticas profesionales",
        "proyecto": "usado en un proyecto",
        "formacion": "aprendido en sus estudios o capacitación, sin proyecto propio asociado",
        "mencion": "listado en el CV, sin proyecto asociado",
    },
    "en": {
        "experiencia": "used at a job or internship",
        "proyecto": "used in a project",
        "formacion": "learned in studies or training, with no project of his own",
        "mencion": "listed in the CV, no associated project",
    },
}


def normalize(text: str) -> str:
    """Lowercase, no accents; keeps letters, digits, + and #."""
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    text = re.sub(r"[^a-z0-9+#.]+", " ", text.lower())
    # keep the dots of "node.js" and ".net", drop the ones that end a word
    return re.sub(r"\.+(?=\s|$)", "", text).strip()


@dataclass
class Fact:
    """One usable piece of evidence: a tech used at a portfolio node."""
    skill_id: str
    name: str
    aliases: list[str]
    kind: str
    domains: list[str]
    level: str
    node: str
    note: str

    def text(self, lang: str, node_label: str) -> str:
        wording = LEVEL_WORDING.get(lang, LEVEL_WORDING["es"])[self.level]
        note = f" — {self.note}" if self.note and self.level != "mencion" else ""
        return f"{self.name} ({self.kind}; {', '.join(self.domains)}): {wording}: {node_label}{note}"


@dataclass
class Lookup:
    facts: list[Fact] = field(default_factory=list)
    unmatched_terms: list[str] = field(default_factory=list)  # asked for, not in the index
    matched_terms: list[str] = field(default_factory=list)    # asked for and in the index (canonical names)


class SkillsIndex:
    def __init__(self, path: str) -> None:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        self.meta = data["meta"]
        self.skills = data["skills"]
        self.domains: list[str] = list(self.meta.get("domains", []))
        self.kinds: list[str] = sorted({s["kind"] for s in self.skills})
        self._by_id = {s["id"]: s for s in self.skills}
        # name/alias → skill id, for matching free text
        self._names: dict[str, str] = {}
        for s in self.skills:
            for n in [s["name"], *s.get("aliases", [])]:
                self._names[normalize(n)] = s["id"]
        dropped = sum(1 for s in self.skills for e in s["evidence"] if e.get("needs_review"))
        log.warning("skills: %d techs, %d evidence entries (%d need review and are never asserted)",
                    len(self.skills), sum(len(s["evidence"]) for s in self.skills), dropped)

    def catalog(self) -> str:
        """Compact list for the "understand" prompt: id | name | kind | domains."""
        return "\n".join(
            f"{s['id']} | {s['name']} | {s['kind']} | {', '.join(s['domains'])}" for s in self.skills
        )

    def _match_name(self, term: str) -> str | None:
        t = normalize(term)
        if t in self._names:
            return self._names[t]
        # "lenguaje TypeScript", "Kotlin/Flutter": any known name as a word
        for name, sid in self._names.items():
            if re.search(rf"(?<![a-z0-9+#]){re.escape(name)}(?![a-z0-9+#])", t):
                return sid
        return None

    def lookup(self, *, techs: list[str], domains: list[str], kinds: list[str],
               terms: list[str]) -> Lookup:
        """Skills selected by explicit ids, by domain (optionally narrowed by
        kind) or by the requested terms ("understand" extracts all of them);
        plus the requested terms the index does not know. The raw question is
        not scanned: "create a node" would match the alias "Node" (Node.js).
        needs_review evidence is dropped."""
        domains = [d for d in domains if d in self.domains]
        kinds = [k for k in kinds if k in self.kinds]
        wanted: list[str] = [t for t in techs if t in self._by_id]

        unmatched, matched = [], []
        for term in terms:
            sid = self._match_name(term)
            if sid:
                wanted.append(sid)
                matched.append(self._by_id[sid]["name"])
            else:
                unmatched.append(term)
        # The visitor named specific techs and the index knows none of them:
        # that is the request, so do not widen it to a whole domain.
        if terms and not matched and not wanted:
            domains, kinds = [], []

        if domains:
            for s in self.skills:
                if set(s["domains"]) & set(domains) and (not kinds or s["kind"] in kinds):
                    wanted.append(s["id"])
        elif kinds:
            wanted += [s["id"] for s in self.skills if s["kind"] in kinds]

        facts: list[Fact] = []
        for sid in dict.fromkeys(wanted):  # dedupe, keep order
            s = self._by_id[sid]
            usable = [e for e in s["evidence"] if not e.get("needs_review")]  # rule: not asserted
            # A CV listing adds nothing to a tech with stronger evidence, and
            # its wording ("no associated project") would then be false.
            if any(e["level"] != "mencion" for e in usable):
                usable = [e for e in usable if e["level"] != "mencion"]
            for e in usable:
                facts.append(Fact(s["id"], s["name"], list(s.get("aliases", [])), s["kind"],
                                  list(s["domains"]), e["level"], e["node"], e.get("note", "")))
        return Lookup(facts=facts, unmatched_terms=unmatched, matched_terms=list(dict.fromkeys(matched)))


def to_hits(lookup: Lookup, labels: dict[str, str], lang: str) -> list[dict]:
    """Facts as rag_search hits (source "skills", score 1.0): they feed the
    rag.result event (title, score, source), the design prompt (body) and the
    source verification (skill, aliases, kind, domains, level)."""
    hits = []
    for f in lookup.facts:
        label = labels.get(f.node, f.node)
        hits.append({
            "node_id": f.node,
            "title": f"{f.name} · {label}",
            "score": 1.0,
            "source": "skills",
            "body": f.text(lang, label),
            "skill": f.name,
            "aliases": f.aliases,
            "kind": f.kind,
            "domains": f.domains,
            "level": f.level,
        })
    return hits


def mentioned_in(terms: list[str], texts: list[str]) -> list[str]:
    """The terms that appear, as whole words, in the given portfolio texts.
    A term the index does not know is not a tech, but it may still be real:
    "Infosys" or "HERMES" are a company and a project of the portfolio, so
    they must never be reported as "no record of"."""
    corpus = " " + " ".join(normalize(t) for t in texts) + " "
    out = []
    for term in terms:
        n = normalize(term)
        if n and re.search(rf"(?<![a-z0-9+#]){re.escape(n)}(?![a-z0-9+#])", corpus):
            out.append(term)
    return out
