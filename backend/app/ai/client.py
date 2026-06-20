"""Thin wrapper around LM Studio's OpenAI-compatible endpoint.

Everything degrades gracefully: if LM Studio is offline the rest of the app keeps
working and AI calls return a clear "unavailable" message instead of raising.
"""
from __future__ import annotations

import logging

from openai import OpenAI

from ..config import settings

log = logging.getLogger(__name__)

_client: OpenAI | None = None


def client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(
            base_url=settings.lmstudio_base_url,
            api_key=settings.lmstudio_api_key or "lm-studio",
            timeout=120,
        )
    return _client


def health() -> dict:
    """Return availability + the models LM Studio currently has loaded."""
    try:
        models = client().models.list()
        ids = [m.id for m in models.data]
        return {"available": True, "models": ids}
    except Exception as exc:  # noqa: BLE001
        log.warning("LM Studio unavailable: %s", exc)
        return {"available": False, "models": [], "error": str(exc)}


def _chat_model() -> str | None:
    if settings.lmstudio_chat_model:
        return settings.lmstudio_chat_model
    h = health()
    return h["models"][0] if h["available"] and h["models"] else None


def chat(messages: list[dict], temperature: float = 0.4, max_tokens: int = 900) -> dict:
    """Run a chat completion. Returns {"ok", "content", "model"}."""
    model = _chat_model()
    if not model:
        return {
            "ok": False,
            "content": "Local AI (LM Studio) is not reachable. Start LM Studio and load a "
            "Gemma model, then retry. Everything else in HouseScout still works.",
            "model": None,
        }
    try:
        resp = client().chat.completions.create(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return {
            "ok": True,
            "content": resp.choices[0].message.content or "",
            "model": model,
        }
    except Exception as exc:  # noqa: BLE001
        log.warning("LM Studio chat failed: %s", exc)
        return {"ok": False, "content": f"AI request failed: {exc}", "model": model}


def embed(texts: list[str]) -> list[list[float]] | None:
    """Embed texts for RAG. Returns None if no embedding model is available."""
    model = settings.lmstudio_embed_model
    if not model:
        return None
    try:
        resp = client().embeddings.create(model=model, input=texts)
        return [d.embedding for d in resp.data]
    except Exception as exc:  # noqa: BLE001
        log.warning("LM Studio embed failed: %s", exc)
        return None
