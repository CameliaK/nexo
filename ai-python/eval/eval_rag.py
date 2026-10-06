"""Calibration of RAG_SIMILARITY_THRESHOLD (docs/eval/).

For each embedding model, every question in docs/eval/preguntas.json is
scored with its best cosine similarity against the RAG fragments — built by
app.rag.build_fragments, the same text the ingestion stores. No database and
no LLM are involved.

Run (one-off container with the agent image, sources mounted):
  docker compose run --rm --no-deps -e PYTHONPATH=/src \
    -v ./ai-python:/src:ro -v ./docs:/docs:ro agent \
    python /src/eval/eval_rag.py > docs/eval/resultados.json

Prints one JSON document: per model and fragment variant, the score of every
question, summary statistics, ROC AUC and a threshold sweep.
"""

import json
import statistics
import sys

import numpy as np
from sentence_transformers import SentenceTransformer

from app.rag import MODEL_NAME, MODEL_REVISION, build_fragments

MODELS = [
    "sentence-transformers/all-MiniLM-L6-v2",
    "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
]
QUESTIONS = "/docs/eval/preguntas.json"
PORTFOLIO = "/docs/portfolio-content.json"


def variants(data: dict) -> dict[str, list[dict]]:
    """'sin_contenido' is what the ingestion stored before the calibration
    (label + summary + keywords); 'con_contenido' adds each node's content
    text and is what it stores now."""
    return {"sin_contenido": build_fragments(data, with_content=False),
            "con_contenido": build_fragments(data, with_content=True)}


def auc(pos: list[float], neg: list[float]) -> float:
    """Mann–Whitney ROC AUC: P(score_relevant > score_irrelevant)."""
    wins = sum((p > n) + 0.5 * (p == n) for p in pos for n in neg)
    return wins / (len(pos) * len(neg))


def sweep(pos: list[float], neg: list[float]) -> dict:
    rows = []
    for t in np.round(np.arange(0.10, 0.951, 0.01), 2):
        tpr = sum(s >= t for s in pos) / len(pos)
        fpr = sum(s >= t for s in neg) / len(neg)
        rows.append({"t": float(t), "tpr": round(tpr, 3), "fpr": round(fpr, 3),
                     "bal_acc": round((tpr + 1 - fpr) / 2, 3)})
    best = max(r["bal_acc"] for r in rows)
    tied = [r["t"] for r in rows if r["bal_acc"] == best]
    # Several thresholds can tie; take the middle of the tied range (the
    # point farthest from both error boundaries).
    chosen = round((min(tied) + max(tied)) / 2, 2)
    return {"best_bal_acc": best, "tied_range": [min(tied), max(tied)], "chosen": chosen, "rows": rows}


def main() -> None:
    qs = json.load(open(QUESTIONS, encoding="utf-8"))["questions"]
    data = json.load(open(PORTFOLIO, encoding="utf-8"))
    frags_by_variant = variants(data)
    report = {"questions": len(qs), "fragments": len(frags_by_variant["con_contenido"]), "results": []}

    for name in MODELS:
        model = SentenceTransformer(name, revision=MODEL_REVISION if name == MODEL_NAME else None)
        dim = model.get_sentence_embedding_dimension()
        q_emb = model.encode([q["q"] for q in qs], normalize_embeddings=True, show_progress_bar=False)
        for variant, frags in frags_by_variant.items():
            f_emb = model.encode([f["body"] for f in frags], normalize_embeddings=True, show_progress_bar=False)
            sims = q_emb @ f_emb.T
            per_q = []
            for q, row in zip(qs, sims):
                i = int(np.argmax(row))
                per_q.append({"id": q["id"], "label": q["label"], "lang": q["lang"],
                              "relevant": q["relevant"], "score": round(float(row[i]), 4),
                              "top": frags[i]["node_id"]})
            pos = [r["score"] for r in per_q if r["relevant"] is True]
            neg = [r["score"] for r in per_q if r["relevant"] is False]
            amb = [r["score"] for r in per_q if r["relevant"] is None]
            stats = {
                "relevant": {"mean": round(statistics.mean(pos), 3), "min": min(pos), "max": max(pos)},
                "irrelevant": {"mean": round(statistics.mean(neg), 3), "min": min(neg), "max": max(neg)},
                "ambiguous": {"mean": round(statistics.mean(amb), 3), "min": min(amb), "max": max(amb)},
                "mean_gap": round(statistics.mean(pos) - statistics.mean(neg), 3),
                "overlap": round(max(neg) - min(pos), 4),  # > 0: the classes overlap
                "auc": round(auc(pos, neg), 3),
            }
            sw = sweep(pos, neg)
            # The decision the threshold actually takes: a question that did
            # not go by route — generate a node, or say "unknown". Node
            # requests skip the threshold (intent + skills index) and
            # injections are stopped by source verification, so the fit that
            # sets the threshold is portafolio vs fuera_de_alcance.
            q_pos = [r["score"] for r in per_q if r["label"] == "portafolio"]
            q_neg = [r["score"] for r in per_q if r["label"] == "fuera_de_alcance"]
            q_stats = {"auc": round(auc(q_pos, q_neg), 3),
                       "portafolio_min": min(q_pos), "fuera_max": max(q_neg),
                       "mean_gap": round(statistics.mean(q_pos) - statistics.mean(q_neg), 3)}
            q_sw = sweep(q_pos, q_neg)
            report["results"].append({"model": name, "dim": dim, "variant": variant,
                                      "stats": stats, "sweep": sw,
                                      "consulta": {"stats": q_stats, "sweep": q_sw},
                                      "per_question": per_q})
            print(f"{name.split('/')[-1]:40} {variant:14} todas: auc={stats['auc']} bal={sw['best_bal_acc']} "
                  f"@{sw['tied_range']} | consulta: auc={q_stats['auc']} bal={q_sw['best_bal_acc']} "
                  f"@{q_sw['tied_range']} -> {q_sw['chosen']}", file=sys.stderr)

    json.dump(report, sys.stdout, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
