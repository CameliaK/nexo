"""English ↔ Spanish equivalents of the portfolio's own vocabulary.

The portfolio is written in Spanish; answers and nodes may be in English.
Source verification is lexical (grounding.py, route_check.py), so an English
word is also accepted when one of its Spanish equivalents is in the sources.

Only ordinary words of this portfolio are listed: no technology names, no
years, no proficiency levels — adding a word here can never make "Rust",
"10 years" or "expert" supported.
"""

import re

from .skills import normalize

# English phrase → Spanish normalized phrase (applied before single words).
PHRASES = {
    "video games": "videojuegos", "video game": "videojuego", "free time": "tiempo libre",
    "screen reader": "lector de pantalla", "screen readers": "lector de pantalla",
    "software engineering": "ingenieria de software", "software engineer": "software engineer",
    "computer science": "ciencias de la computacion", "systems engineering": "ingenieria de sistemas",
    "card game": "juego de cartas", "turn based": "por turnos", "digital twin": "digital twin gemelo digital",
    "predictive maintenance": "mantenimiento predictivo", "time series": "series de tiempo",
    "stored procedures": "procedimientos almacenados", "real time": "tiempo real",
    "personal projects": "proyectos personales", "academic projects": "proyectos academicos",
    "this portfolio": "este portafolio", "live chat": "chat en vivo", "machine learning": "machine learning ml",
    "artificial intelligence": "inteligencia artificial ia", "under construction": "en construccion",
    "in progress": "en construccion", "design patterns": "patrones de diseno", "object oriented": "orientada a objetos",
    "financial management": "financial management financiero", "business management": "gestion de negocios",
    "pharmaceutical care": "atencion farmaceutica", "treatment adherence": "adherencia al tratamiento",
    "middle school": "secundaria", "elementary school": "primaria", "primary school": "primaria",
    "high school": "preparatoria", "kindergarten": "jardin de ninos", "full stack": "full stack",
    "industrial tool search": "buscador industrial de herramientas", "search engine": "buscador",
    "technical english": "ingles tecnico", 
}

# English word → Spanish normalized words.
WORDS = {
    "sports": "deportes", "sport": "deporte", "tennis": "tenis", "swimming": "natacion", "swim": "nadar natacion",
    "basketball": "basquetbol", "baseball": "beisbol", "soccer": "futbol", "football": "futbol",
    "volleyball": "voleibol", "games": "juegos", "game": "juego", "gaming": "videojuegos", "competitive": "competitivo",
    "survival": "supervivencia", "art": "arte", "arts": "artes", "drawing": "dibujo", "music": "musica",
    "hobbies": "hobbies", "hobby": "hobbies", "rank": "rango", "ranked": "rango", "tournaments": "torneos",
    "tournament": "torneos", "training": "capacitacion entrenamiento", "trained": "entrene capacitacion",
    "trains": "entreno", "practiced": "practique", "played": "practique jugar", "plays": "jugar juega",
    "play": "jugar", "enjoys": "disfruto", "enjoy": "disfruto", "likes": "gusta", "creativity": "creatividad",
    "friends": "amigos", "partner": "pareja", "parents": "padres", "school": "escuela", "university": "universidad",
    "college": "universidad", "studies": "estudios", "studied": "estudie", "study": "estudios", "degree": "carrera",
    "major": "carrera", "graduate": "egresado", "graduated": "egresado", "outstanding": "sobresaliente",
    "engineering": "ingenieria", "engineer": "ingeniero engineer", "internship": "internship", "intern": "intern",
    "course": "curso", "courses": "cursos", "project": "proyecto", "projects": "proyectos", "academic": "academico",
    "personal": "personal", "work": "trabajo", "worked": "trabaje", "job": "trabajo empleo", "jobs": "trabajos",
    "experience": "experiencia", "role": "rol", "period": "periodo", "place": "lugar", "languages": "idiomas",
    "english": "ingles", "spanish": "espanol", "native": "nativo", "technical": "tecnico", 
    "accessibility": "accesibilidad", "accessible": "accesibles", "educational": "educativas", "education": "educacion",
    "platform": "plataforma", "platforms": "plataformas", "search": "buscador busqueda", "industrial": "industrial",
    "tool": "herramienta", "tools": "herramientas", "predictive": "predictivo", "maintenance": "mantenimiento",
    "correspondence": "correspondencia", "system": "sistema", "systems": "sistemas", "module": "modulo",
    "modules": "modulos", "optimization": "optimizacion", "optimized": "optimizacion mejore", "queries": "consultas",
    "query": "consulta", "response": "respuesta", "times": "tiempos", "rows": "filas", "performance": "rendimiento",
    "database": "base datos", "online": "linea online", "deck": "mazo", "credits": "creditos", "credit": "credito",
    "financial": "financiero", "management": "gestion", "business": "negocios", "businesses": "negocios",
    "pharmaceutical": "farmaceutica", "health": "salud", "architecture": "arquitectura", "born": "naci",
    "origin": "origen", "age": "edad", "name": "nombre", "contact": "contacto", "email": "correo",
    "phone": "celular telefono", "developed": "desarrolle", "develop": "desarrollo", "development": "desarrollo",
    "built": "construi", "build": "construir", "implemented": "implemente", "improved": "mejore", "led": "lidere",
    "designed": "disene", "design": "diseno", "participated": "participe", "started": "empece", "received": "recibi",
    "learned": "aprendi", "learning": "aprendizaje", "programming": "programacion", "fundamentals": "bases",
    "methodologies": "metodologias", "patterns": "patrones", "client": "cliente", "mobile": "movil", "app": "app",
    "application": "aplicacion", "real": "real", "teams": "equipos", "team": "equipo", "features": "funcionalidades",
    "functionality": "funcionalidades", "failures": "fallas",
    "minutes": "minutos", "seconds": "segundos", "india": "india", "campus": "campus", "agentic": "agentica",
    "models": "modelos", "model": "modelo", "data": "datos", "semantic": "semantica", "retrieval": "recuperacion",
    "recommendations": "recomendaciones", "students": "estudiantes", "student": "estudiante", 
    "digital": "digitales", "support": "apoyo", "pipeline": "pipeline", "chat": "chat", "message": "mensaje",
    "status": "estatus", "current": "actual", "construction": "construccion", "favorite": "favorito",
    "information": "informacion", "about": "sobre", "basics": "bases", "solid": "solidas",
}

MONTHS = {
    "january": "ene", "february": "feb", "march": "mar", "april": "abr", "may": "may", "june": "jun",
    "july": "jul", "august": "ago", "september": "sep", "october": "oct", "november": "nov", "december": "dic",
    "enero": "ene", "febrero": "feb", "marzo": "mar", "abril": "abr", "mayo": "may", "junio": "jun", "julio": "jul",
    "agosto": "ago", "septiembre": "sep", "setiembre": "sep", "octubre": "oct", "noviembre": "nov", "diciembre": "dic",
    "jan": "ene", "feb": "feb", "mar": "mar", "apr": "abr", "jun": "jun", "jul": "jul", "aug": "ago", "sep": "sep",
    "sept": "sep", "oct": "oct", "nov": "nov", "dec": "dic", "ene": "ene", "abr": "abr", "ago": "ago", "dic": "dic",
}

NUMBER_WORDS = {
    "uno": "1", "una": "1", "un": "1", "one": "1", "dos": "2", "two": "2", "tres": "3", "three": "3",
    "cuatro": "4", "four": "4", "cinco": "5", "five": "5", "seis": "6", "six": "6", "siete": "7", "seven": "7",
    "ocho": "8", "eight": "8", "nueve": "9", "nine": "9", "diez": "10", "ten": "10", "once": "11",
    "eleven": "11", "doce": "12", "twelve": "12",
}

_PHRASE_RE = re.compile(r"(?<![a-z0-9])(" + "|".join(re.escape(p) for p in sorted(PHRASES, key=len, reverse=True))
                        + r")(?![a-z0-9])")


def to_spanish(norm_text: str) -> str:
    """A normalized text with English phrases replaced by their Spanish
    equivalents (single words are handled by equivalents())."""
    return _PHRASE_RE.sub(lambda m: PHRASES[m.group(1)], norm_text)


def equivalents(word: str) -> list[str]:
    """Spanish normalized words equivalent to an English normalized word."""
    return WORDS.get(word, "").split()


def in_text(term: str, norm_corpus: str) -> bool:
    """Is a term (any language) in a normalized Spanish corpus — literally,
    or through its Spanish equivalents, word by word?"""
    t = normalize(term)
    if not t:
        return True
    if f" {t} " in norm_corpus:
        return True
    es = to_spanish(t)
    if f" {es} " in norm_corpus:
        return True
    words = es.split()
    return all(f" {w} " in norm_corpus or any(f" {e} " in norm_corpus for e in equivalents(w)) for w in words)


def stems(word: str) -> list[str]:
    """The word and its Spanish equivalents (for 5-letter stem matching)."""
    return [word, *equivalents(word)]
