FROM python:3.13-slim
WORKDIR /app

# Install CPU-only torch first so pip doesn't pull the 2 GB CUDA wheel
# when it later resolves sentence-transformers' torch dependency
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Bake the embedding model into the image so the first request doesn't stall
# waiting for a Hugging Face download. Same name and pinned revision as
# app/rag.py (MODEL_NAME, MODEL_REVISION); ~470 MB of weights.
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2', revision='e8f8c211226b894fcb81acc59f3b34ba3efd5f42')"

COPY app/ ./app/
COPY ingest.py ./

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')" || exit 1

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
