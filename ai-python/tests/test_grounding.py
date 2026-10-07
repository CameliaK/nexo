"""Skills index rules and source verification, against the real
knowledge/skills.json. Run in the agent image:
  docker compose run --rm --no-deps -w /src -v ./ai-python:/src:ro \
    -v ./knowledge:/knowledge:ro -v ./docs:/docs:ro agent \
    sh -c "pip install -q pytest==9.1.1 && python -m pytest -q -p no:cacheprovider /src/tests"
"""

import json

import pytest

from app import grounding
from app.skills import SkillsIndex, to_hits

INDEX = SkillsIndex("/knowledge/skills.json")
LABELS = {n["id"]: n["label"] for n in json.load(open("/docs/portfolio-content.json"))["nodes"]}


def evidence(**q):
    q = {"techs": [], "domains": [], "kinds": [], "terms": [], **q}
    lk = INDEX.lookup(**q)
    return lk, grounding.build_evidence(to_hits(lk, LABELS, "es"))


def node(layout, content, label="Lenguajes de frontend", summary="Lenguajes de frontend que ha usado."):
    return {"id": "gen_x", "label": label, "summary": summary, "layout": layout,
            "content": content, "children": [], "sources": []}


def test_needs_review_is_never_asserted(tmp_path):
    # Synthetic index: the rule must not depend on which real evidence is
    # still pending review in knowledge/skills.json.
    path = tmp_path / "skills.json"
    path.write_text(json.dumps({
        "meta": {"domains": ["backend"]},
        "skills": [{
            "id": "fakelang", "name": "FakeLang", "aliases": [], "kind": "language",
            "domains": ["backend"],
            "evidence": [
                {"level": "proyecto", "node": "test.confirmado", "note": "Confirmada."},
                {"level": "experiencia", "node": "test.pendiente", "note": "Sin confirmar.",
                 "needs_review": True},
            ],
        }],
    }), encoding="utf-8")
    index = SkillsIndex(str(path))
    for query in ({"techs": ["fakelang"]}, {"terms": ["FakeLang"]}, {"domains": ["backend"]}):
        lk = index.lookup(**{"techs": [], "domains": [], "kinds": [], "terms": [], **query})
        assert [(f.node, f.level) for f in lk.facts] == [("test.confirmado", "proyecto")], query


def test_mencion_is_worded_as_cv_listing():
    only = next(s for s in INDEX.skills
                if {e["level"] for e in s["evidence"] if not e.get("needs_review")} == {"mencion"})
    lk, _ = evidence(techs=[only["id"]])
    texts = [f.text("es", LABELS[f.node]) for f in lk.facts]
    assert texts and all("listado en el CV, sin proyecto asociado" in t for t in texts)


def test_cv_listing_is_dropped_when_there_is_stronger_evidence():
    lk, _ = evidence(techs=["typescript"])
    assert lk.facts and all(f.level != "mencion" for f in lk.facts)


def test_sources_are_the_ones_the_element_talks_about():
    _, ev = evidence(techs=["csharp"])
    out, _ = grounding.verify_node(node("list", {"items": [
        "C#: Frontend en C# sobre .NET con Avalonia UI en Financial Management System.",
        "C#: Backend del sistema HERMES en C# sobre .NET."]}, label="C#", summary="Dónde ha usado C#."), ev)
    assert [s["ref"] for s in out["sources"]] == [
        "aprendizaje.proyectos-academicos.sistema-financiero", "experiencia.dgti.hermes"]


def test_unknown_terms_are_reported():
    lk, _ = evidence(terms=["Rust", "Haskell", "Go"])
    assert lk.unmatched_terms == ["Rust", "Haskell"]
    assert any(f.skill_id == "go" for f in lk.facts)


def test_frontend_languages_keep_real_ones_and_drop_invented():
    _, ev = evidence(domains=["frontend"], kinds=["language"])
    out, rep = grounding.verify_node(node("tags", {"tags": ["JavaScript", "TypeScript", "HTML", "Rust", "Experto en React"]}), ev)
    assert out["content"]["tags"] == ["JavaScript", "TypeScript", "HTML"]
    assert "Rust" in rep.dropped and "Experto en React" in rep.dropped
    assert out["sources"] and all(s["ref"] in LABELS for s in out["sources"])


def test_years_and_levels_are_dropped():
    _, ev = evidence(techs=["go", "python"])
    items = ["8 años de experiencia en Go", "Nivel avanzado de Python", "Python en el buscador industrial de herramientas"]
    out, rep = grounding.verify_node(node("list", {"items": items + ["Python en mantenimiento predictivo"]},
                                          label="Python y Go", summary="Dónde ha usado Python y Go."), ev)
    assert items[0] in rep.dropped and items[1] in rep.dropped
    assert items[2] in out["content"]["items"]


def test_mention_only_tech_needs_the_cv_qualifier():
    only = [s for s in INDEX.skills
            if {e["level"] for e in s["evidence"] if not e.get("needs_review")} == {"mencion"}]
    assert only, "the index should have techs listed only in the CV"
    s = only[0]
    _, ev = evidence(techs=[s["id"]])
    bare, qualified = s["name"], f"{s['name']}: listado en el CV, sin proyecto asociado"
    out, rep = grounding.verify_node(node("list", {"items": [bare, qualified, qualified + "."]},
                                          label=s["name"], summary=f"{s['name']} en el CV."), ev)
    assert bare in rep.dropped
    assert qualified in out["content"]["items"]
    out, rep = grounding.verify_node(node("tags", {"tags": [bare, bare + " "]}, label=s["name"], summary="CV."), ev)
    assert out is None  # a bare tag cannot carry the qualifier


def test_not_enough_left_means_no_node():
    _, ev = evidence(terms=["Rust"])
    out, _ = grounding.verify_node(node("tags", {"tags": ["Rust", "Kubernetes"]}, label="Rust", summary="Rust y Kubernetes."), ev)
    assert out is None


def test_unknown_named_techs_do_not_widen_to_a_domain():
    lk, _ = evidence(terms=["Rust", "Haskell"], domains=["backend"])
    assert lk.facts == [] and lk.matched_terms == []
    lk, _ = evidence(terms=["Go", "Haskell"], domains=["backend"])
    assert lk.matched_terms == ["Go"] and lk.unmatched_terms == ["Haskell"]
