"""Third-person voice for the owner (app/voice.py): what is detected, what
is fixed in place and what is left to a regeneration."""

from app import node_builder, voice


def rules(text, lang, kind="answer"):
    return [(v.rule, v.fixable) for v in voice.check(text, lang, kind)]


def test_feminine_forms_are_fixed():
    assert voice.fix("She trained there; it covers her internship and told her.", "en") == \
        "He trained there; it covers his internship and told him."
    assert voice.fix("Ella es egresada y la desarrolladora de HERMES.", "es") == \
        "Él es egresado y el desarrollador de HERMES."
    assert voice.fix("Fue la estudiante con mejor EGEL.", "es") == "Fue el estudiante con mejor EGEL."


def test_owner_first_person_in_a_node_becomes_third_person():
    src = ("Durante mi internship en India recibí capacitación. Desarrollé un sistema RAG y entrené modelos. "
           "Empecé tenis; practiqué béisbol con mis padres. Me gusta Minecraft. He entrenado. Construí Astralis.")
    assert voice.fix(src, "es", "node") == (
        "Durante su internship en India recibió capacitación. Desarrolló un sistema RAG y entrenó modelos. "
        "Empezó tenis; practicó béisbol con sus padres. Le gusta Minecraft. Ha entrenado. Construyó Astralis.")
    assert voice.fix("During my internship I worked on RAG. I've built agents and I play tennis.", "en", "node") == \
        "During his internship Kirbith worked on RAG. Kirbith has built agents and Kirbith plays tennis."
    assert voice.check(voice.fix(src, "es", "node"), "es", "node") == []


def test_the_agent_may_speak_in_the_first_person():
    ok_es = ("Entendí que te refieres a Kirbith. Ya existe un nodo, así que te llevé ahí; también creé uno nuevo "
             "y he creado tu lista. Si quieres, revisa tu nuevo nodo o tu pregunta.")
    ok_en = "I understood you mean Kirbith. I took you to his node and I created a new one for your question."
    assert rules(ok_es, "es") == [] and rules(ok_en, "en") == []


def test_quotes_of_the_visitor_are_not_checked():
    assert rules('I understood you mean Kirbith when you wrote "my AI experience".', "en") == []
    assert rules("Entendí que «mis proyectos» se refiere a Kirbith.", "es") == []


def test_tuteo_about_kirbith():
    assert voice.fix("Ya existe un nodo sobre tu experiencia en Infosys.", "es") == \
        "Ya existe un nodo sobre su experiencia en Infosys."
    assert voice.fix("It covers your internship at Infosys.", "en") == "It covers his internship at Infosys."
    # verbs cannot be rewritten mechanically: left for the regeneration
    assert ("tuteo", False) in rules("No puedo afirmar que lo usaras allí.", "es")
    assert ("tuteo", False) in rules("You worked at Infosys.", "en")
    assert rules("Ya existe un nodo; consiste en dos partes claras.", "es") == []


def test_owner_first_person_in_an_answer():
    assert voice.fix("También aprendí RAG y I worked there.", "es") == "También aprendió RAG y I worked there."
    assert voice.fix("Then I worked at Infosys.", "en") == "Then Kirbith worked at Infosys."


def test_voice_node_fixes_and_drops():
    node = {"id": "gen_x", "label": "Mi experiencia en IA", "summary": "Lo que aprendí en Infosys.",
            "layout": "list", "content": {"items": ["Desarrollé un sistema RAG.", "Entrené modelos.",
                                                    "Lo usaste en Infosys."]},
            "children": [], "sources": [{"ref": "aprendizaje.extras.infosys-ia", "title": "IA y ML en Infosys"}]}
    out, unresolved = node_builder.voice_node(node, "es")
    assert out["label"] == "Su experiencia en IA" and out["summary"] == "Lo que aprendió en Infosys."
    assert out["content"]["items"] == ["Desarrolló un sistema RAG.", "Entrenó modelos."]
    assert len(unresolved) == 1
    out, _ = node_builder.voice_node({**node, "label": "Lo que usaste"}, "es")
    assert out is None
