"""Embedding-backed retrieval for the chat assistant (RAG).

Builds a short text per listing, embeds it via LM Studio's embedding model, stores
the vector as JSON, and retrieves the most relevant listings for a query using
cosine similarity (numpy — fine for the scale of a personal listing database).

Degrades gracefully: if no embedding model is configured/available, callers fall
back to score-ordered retrieval.
"""
from __future__ import annotations

import logging

import numpy as np
from sqlalchemy.orm import Session

from . import client
from ..config import settings
from ..models import Embedding, Listing, Score

log = logging.getLogger(__name__)


def listing_text(listing: Listing) -> str:
    """Compact natural-language description used for embedding + retrieval."""
    enr = listing.enrichment
    land = (enr.land_area_m2 if enr else None) or listing.land_area_m2
    parts = [
        listing.address or "",
        f"in {listing.suburb}" if listing.suburb else "",
        f"{listing.property_type or 'house'}",
        f"${listing.price:,.0f}" if listing.price else "",
        f"{listing.bedrooms or '?'} bed",
        f"{listing.bathrooms or '?'} bath",
        "garage" if listing.has_garage else "no garage",
        f"{int(land)} m2 land" if land else "",
        listing.description or "",
    ]
    return " · ".join(p for p in parts if p)


def reindex(db: Session, refresh: bool = False) -> dict:
    """(Re)build embeddings for listings missing one. Returns a summary dict."""
    model = settings.lmstudio_embed_model
    if not model:
        return {"ok": False, "reason": "no embedding model configured", "indexed": 0}

    q = db.query(Listing)
    listings = q.all()
    todo: list[Listing] = []
    existing = {e.listing_id: e for e in db.query(Embedding).all()}
    for l in listings:
        if refresh or l.id not in existing or existing[l.id].model != model:
            todo.append(l)
    if not todo:
        return {"ok": True, "indexed": 0, "total": len(listings)}

    texts = [listing_text(l) for l in todo]
    vectors = client.embed(texts)
    if not vectors:
        return {"ok": False, "reason": "embedding call failed/unavailable", "indexed": 0}

    for l, text, vec in zip(todo, texts, vectors):
        emb = existing.get(l.id) or Embedding(listing_id=l.id)
        emb.model = model
        emb.dim = len(vec)
        emb.vector = vec
        emb.text = text
        db.add(emb)
    db.commit()
    return {"ok": True, "indexed": len(todo), "total": len(listings)}


def _cosine_topk(query_vec: list[float], rows: list[tuple[int, list[float]]], k: int) -> list[int]:
    if not rows:
        return []
    q = np.asarray(query_vec, dtype=np.float32)
    qn = np.linalg.norm(q) or 1.0
    mat = np.asarray([r[1] for r in rows], dtype=np.float32)
    norms = np.linalg.norm(mat, axis=1)
    norms[norms == 0] = 1.0
    sims = (mat @ q) / (norms * qn)
    order = np.argsort(-sims)[:k]
    return [rows[i][0] for i in order]


def retrieve(db: Session, question: str, k: int = 12) -> tuple[list[Listing], bool]:
    """Return (listings, used_embeddings). Falls back to score order when needed."""
    model = settings.lmstudio_embed_model
    embs = (
        db.query(Embedding).all() if model else []
    )
    if model and embs:
        qv = client.embed([question])
        if qv:
            rows = [(e.listing_id, e.vector) for e in embs if e.vector]
            ids = _cosine_topk(qv[0], rows, k)
            if ids:
                found = {l.id: l for l in db.query(Listing).filter(Listing.id.in_(ids)).all()}
                ordered = [found[i] for i in ids if i in found]
                if ordered:
                    return ordered, True

    # Fallback: top passing listings by match score.
    rows = (
        db.query(Listing)
        .join(Score, isouter=True)
        .filter(Listing.status == "active")
        .order_by(Score.match_score.desc().nullslast())
        .limit(k)
        .all()
    )
    return rows, False
