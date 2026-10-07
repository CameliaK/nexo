"""Route answers verified against their sources (app/route_check.py), and
language-aware node verification (app/lexicon.py). Real portfolio and
skills index; no LLM."""

import json

from app import grounding, route_check
from app.portfolio import load_portfolio
from app.rag import build_fragments
from app.skills import SkillsIndex

PORTFOLIO = load_portfolio("/docs/portfolio-content.json")
SKILLS = SkillsIndex("/knowledge/skills.json")
EDU = ["aprendizaje", "aprendizaje.universidad", "aprendizaje.universidad.carrera"]


def findings(answer, path, techs=()):
    ctx = route_check.build(path, PORTFOLIO, SKILLS, list(techs))
    return [(f.claim, f.why) for f in route_check.verify(answer, ctx, PORTFOLIO, SKILLS)]


def test_the_three_production_falsehoods_are_caught():
    assert findings("Kirbith es egresado de Ingeniería de Sistemas.", EDU)
    assert findings("Kirbith usó C# en su internship.", ["experiencia"], ["csharp"])
    assert findings("Kirbith gained C# experience during his internship.", ["experiencia"], ["C#"])
    assert findings("Kirbith sigue estudiando en la universidad.", EDU)
    assert findings("He is pursuing his studies at university while working.", ["aprendizaje", "experiencia"])


def test_their_true_versions_pass():
    assert findings("Kirbith estudió Ingeniería de Software en la Universidad Veracruzana y es egresado.", EDU) == []
    assert findings("Kirbith graduated in Software Engineering from the Universidad Veracruzana, "
                    "with EGEL-IS Sobresaliente.", EDU) == []
    assert findings("Kirbith usó C# en HERMES, en la DGTI UV, y en Astralis.", ["experiencia"], ["csharp"]) == []
    assert findings("Kirbith ya no estudia: es egresado.", EDU) == []
    assert findings("Te llevé al nodo «Dónde y qué estudié».", EDU) == []


def test_dates_durations_and_employers_must_be_in_the_sources():
    infosys = ["experiencia", "experiencia.infosys"]
    assert findings("Fue Software Engineer Intern en Bangalore, India, de febrero a agosto de 2025.", infosys) == []
    assert findings("Kirbith worked there from February to August 2025.", infosys) == []
    assert findings("Trabajó en Infosys durante seis meses.", infosys)       # derived, not written
    assert findings("Trabajó en Infosys desde 2023.", infosys)
    assert findings("Kirbith also worked at Google.", infosys)
    assert findings("Fue líder técnico del equipo en Infosys.", infosys)
    assert findings("Usó Rust en Infosys.", infosys)


def test_live_status_only_where_the_sources_say_so():
    assert findings("FleetFix está en construcción.", ["proyectos-personales", "proyectos-personales.negocios-ia"]) == []
    assert findings("Kirbith sigue entrenando tenis para competir en torneos amateur.",
                    ["hobbies", "hobbies.deportes", "hobbies.deportes.tenis"]) == []
    assert findings("Kirbith currently works at DGTI.", ["experiencia", "experiencia.dgti"])
    assert findings("Todavía no tengo ese detalle; te llevé al nodo «DGTI UV».", ["experiencia", "experiencia.dgti"]) == []


def test_owner_status_is_derived_from_the_data():
    assert "egresado de Ingeniería de Software" in route_check.owner_status(PORTFOLIO)
    ctx = route_check.build(["hobbies"], PORTFOLIO, SKILLS)
    assert "Ya no estudia" in ctx.prompt                    # in every route answer's sources


def test_route_sources_have_the_full_content():
    ctx = route_check.build(["experiencia", "experiencia.dgti", "experiencia.dgti.hermes"], PORTFOLIO, SKILLS)
    for text in ("procedimientos almacenados", "Capa JavaScript", "De más de 1M a 100K filas",
                 "Backend del sistema HERMES en C#", "Agosto 2024 – Enero 2025"):
        assert text in ctx.prompt, text


def test_fallback_is_only_the_summary_and_the_node():
    ctx = route_check.build(["experiencia"], PORTFOLIO, SKILLS)
    assert route_check.fallback(ctx, "es") == ("Te llevé a «Experiencia»: Dónde ha trabajado y los proyectos en los "
                                               "que ha contribuido. No tengo más detalle verificado que agregar.")
    assert findings(route_check.fallback(ctx, "en"), ["experiencia"]) == []


def _evidence(*node_ids):
    frags = [f for f in build_fragments(json.load(open("/docs/portfolio-content.json"))) if f["node_id"] in node_ids]
    return grounding.build_evidence([{**f, "score": 0.5} for f in frags])


def _node(label, summary, tags):
    return {"id": "gen_x", "label": label, "summary": summary, "layout": "tags", "content": {"tags": tags},
            "children": [], "sources": []}


def test_english_node_from_spanish_sources_is_verified_like_spanish():
    ev = _evidence("hobbies", "hobbies.deportes", "hobbies.videojuegos", "hobbies.deportes.tenis")
    en, _ = grounding.verify_node(_node("Kirbith's Sports and Video Games", "Sports and video games Kirbith plays.",
                                        ["Tennis", "Swimming", "Volleyball", "Rocket League", "Rust", "10 years of experience"]), ev)
    es, _ = grounding.verify_node(_node("Deportes y videojuegos de Kirbith", "Deportes y videojuegos que practica.",
                                        ["Tenis", "Natación", "Voleibol", "Rocket League", "Rust", "10 años de experiencia"]), ev)
    assert en is not None and es is not None
    assert en["content"]["tags"] == ["Tennis", "Swimming", "Volleyball", "Rocket League"]
    assert es["content"]["tags"] == ["Tenis", "Natación", "Voleibol", "Rocket League"]


def test_lexicon_does_not_loosen_rejections():
    ev = _evidence("hobbies", "hobbies.deportes")
    out, rep = grounding.verify_node(_node("Kirbith's expertise", "Kirbith is an expert with 10 years of experience.",
                                           ["Kubernetes", "Haskell"]), ev)
    assert out is None


def test_every_place_of_a_tech_needs_evidence_and_studying_needs_a_negation():
    assert findings("Kirbith trabajó con C# durante su internship y en proyectos académicos.", ["aprendizaje"], ["C#"])
    assert findings("Kirbith usó C# en HERMES y en proyectos académicos.", ["aprendizaje", "experiencia"], ["C#"]) == []
    assert findings("Kirbith sigue estudiando: es egresado de Ingeniería de Software.", EDU)
    assert findings("Kirbith is both a student and already working.", ["aprendizaje", "experiencia"])
    assert findings("Kirbith is not studying anymore: he is a graduate.", EDU) == []


def test_techs_and_places_cover_each_other():
    path = ["experiencia", "aprendizaje"]
    assert findings("Kirbith usó C# en HERMES, Astralis y el sistema financiero, con WPF, WCF y Avalonia UI.",
                    path, ["C#"]) == []
    assert findings("Kirbith usó C# en HERMES y en su internship.", path, ["C#"])
    assert findings("No hay ningún registro de Rust en su paso por Infosys.", ["experiencia", "experiencia.infosys"]) == []
    assert findings("Astralis is one of his Academic Projects.",
                    ["aprendizaje", "aprendizaje.proyectos-academicos", "aprendizaje.proyectos-academicos.astralis"]) == []


def test_regeneration_feedback_says_where_the_tech_was_used():
    ctx = route_check.build(["experiencia", "aprendizaje"], PORTFOLIO, SKILLS, ["C#"])
    found = route_check.verify("Kirbith usó C# y Avalonia UI en HERMES.", ctx, PORTFOLIO, SKILLS)
    assert found and "Avalonia UI se usó en: Financial Management System" in route_check.feedback(found)
    assert findings("Usó C# con Avalonia UI en el sistema de gestión financiera.", ["aprendizaje"], ["C#"]) == []
