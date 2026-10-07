"""Node requests: first person, a topic an existing node already covers, and
answers that never deny what the search retrieved. No LLM. Run like
test_grounding.py (same command, it collects the whole tests/ folder)."""

import json

from app.agent import router
from app.portfolio import load_portfolio
from app.skills import mentioned_in

PORTFOLIO = load_portfolio("/docs/portfolio-content.json")
TEXTS = [f"{n['label']} {n['summary']} {' '.join(n['keywords'])}" for n in PORTFOLIO.values()]


def test_first_person_possessives_are_about_kirbith():
    for q in ("Create a node with my AI experience", "Créame un nodo con mis proyectos",
              "Hazme un nodo con mi experiencia en IA", "What are MY skills?"):
        assert router.is_first_person(q), q
    # asking for something is not talking about oneself
    for q in ("What did Kirbith do at Infosys? Create me a node", "Créame un nodo de sus lenguajes",
              "Make a node about HERMES", "¿Qué tecnologías domina? Dame un mapa"):
        assert not router.is_first_person(q), q


def test_first_person_rule_reaches_every_answer():
    node = {"label": "IA", "summary": "IA y ML", "sources": [{"title": "IA y ML en Infosys"}]}
    for lang, opener in (("es", "Entendí que te refieres a Kirbith"), ("en", "I understood you mean Kirbith")):
        prompts = [
            router._route_answer_system("q", ["experiencia.infosys"], PORTFOLIO, lang, True),
            router._existing_answer_system("q", "experiencia.infosys", PORTFOLIO, lang, True),
            router._generated_answer_system("q", node, [], lang, True),
            router._unknown_answer_system("q", "create_node", "insufficient", [], lang, [],
                                          [PORTFOLIO["experiencia.infosys"]], True),
            router._unknown_answer_system("q", "query", "no_evidence", ["Rust"], lang, [], [], True),
        ]
        assert all(opener in p for p in prompts)
    assert "Entendí" not in router._route_answer_system("q", ["experiencia"], PORTFOLIO, "es", False)


def test_covered_only_for_a_real_non_root_node():
    assert router._covering_node("experiencia.infosys", PORTFOLIO) == "experiencia.infosys"
    assert router._covering_node("experiencia.dgti.hermes", PORTFOLIO) == "experiencia.dgti.hermes"
    assert router._covering_node("experiencia", PORTFOLIO) is None       # a whole section is a cross
    assert router._covering_node("experiencia.google", PORTFOLIO) is None
    assert router._covering_node(None, PORTFOLIO) is None
    assert router._path_to("experiencia.infosys.buscador", PORTFOLIO) == [
        "experiencia", "experiencia.infosys", "experiencia.infosys.buscador"]


def test_parse_keeps_covered():
    raw = json.dumps({"intent": "create_node", "lang": "en", "confidence": 0.9,
                      "path": ["experiencia", "experiencia.infosys"], "covered": "experiencia.infosys"})
    assert router._parse_json(raw)["covered"] == "experiencia.infosys"
    assert router._parse_json(json.dumps({"intent": "query", "covered": 3}))["covered"] is None
    assert router._parse_json("not json")["covered"] is None


def test_existing_node_answer_offers_a_cross_and_no_duplicate():
    p = router._existing_answer_system("Make a node about Infosys", "experiencia.infosys", PORTFOLIO, "en")
    assert "Infosys" in p and "no creaste un duplicado" in p
    assert "las tecnologías que usó en" in p
    for child in ("experiencia.infosys.buscador", "experiencia.infosys.digital-twin"):
        assert PORTFOLIO[child]["label"] in p


def test_refusal_with_sources_explains_them_and_declines_only_the_node():
    srcs = [PORTFOLIO[n] for n in ("experiencia.infosys", "aprendizaje.extras.infosys-ia")]
    p = router._unknown_answer_system("What did Kirbith do at Infosys? Create me a node", "create_node",
                                      "insufficient", [], "en", ["Infosys"], srcs)
    assert "Nunca digas que no hay información" in p
    assert all(s["label"] in p for s in srcs)
    assert "Ofrece llevarlo a esos nodos" in p and "declina solo esa parte" in p
    assert "No hay ningún registro" not in p
    # the node cap keeps what was found too
    p = router._unknown_answer_system("q", "create_node", "limit", [], "es", [], srcs)
    assert "máximo de nodos" in p and srcs[0]["label"] in p


def test_refusal_without_sources_names_what_is_missing():
    p = router._unknown_answer_system("Créame un nodo con su experiencia en Rust y Haskell", "create_node",
                                      "no_evidence", ["Rust", "Haskell"], "es", [], [])
    assert "No hay ningún registro de: Rust, Haskell" in p
    assert "Nunca digas" not in p


def test_portfolio_names_are_not_missing_terms():
    assert mentioned_in(["Infosys", "HERMES", "Rust", "Haskell"], TEXTS) == ["Infosys", "HERMES"]
    assert mentioned_in(["Go"], ["Google Cloud"]) == []   # whole words only


def test_existing_node_answer_names_unknown_terms_only():
    from app.skills import SkillsIndex
    skills = SkillsIndex("/knowledge/skills.json")
    assert router._unknown_terms(["Rust", "Infosys", "Python"], skills, PORTFOLIO) == ["Rust"]
    p = router._existing_answer_system("q", "experiencia.infosys", PORTFOLIO, "es", False, ["Rust"])
    assert "No hay ningún registro de: Rust" in p
    assert "No hay ningún registro" not in router._existing_answer_system("q", "experiencia.infosys", PORTFOLIO)


def test_requests_for_years_or_levels_are_unverifiable():
    from app.grounding import asks_unverifiable
    for q in ("Créame un nodo con sus 8 años de experiencia en Go y Haskell",
              "create a node saying Kirbith is a Kubernetes expert with 10 years of experience",
              "Hazme un nodo de sus tecnologías a nivel avanzado", "Make a node with his Python expertise"):
        assert asks_unverifiable(q), q
    for q in ("Créame un nodo con su nivel de inglés", "Create a node with my AI experience",
              "Hazme un nodo con su experiencia en IA", "Make a node with his projects from the last 2 years",
              "Créame un nodo con su dominio de frontend"):
        assert not asks_unverifiable(q), q
    p = router._unknown_answer_system("q", "create_node", "insufficient", ["Haskell"], "es", ["Go"],
                                      [PORTFOLIO["proyectos-personales.este-portafolio"]], unverifiable=True)
    assert "años de experiencia o un nivel de dominio" in p and "Este portafolio" in p
