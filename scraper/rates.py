"""Live mortgage-rate scraper for interest.co.nz.

The mortgage rate comparison tables are server-rendered HTML, so this uses httpx +
selectolax (no browser needed). Parsing is split out as `parse_rates_html` so it can
be unit-tested against a saved sample without any network.

Personal use; light footprint (a single GET).
"""
from __future__ import annotations

import logging
import re

import httpx
from selectolax.parser import HTMLParser

log = logging.getLogger(__name__)

RATES_URL = "https://www.interest.co.nz/borrowing"

# Map free-text term headers to compact labels used in the DB.
_TERM_PATTERNS = [
    (re.compile(r"\bfloat", re.I), "floating"),
    (re.compile(r"6\s*month", re.I), "6mo"),
    (re.compile(r"18\s*month", re.I), "18mo"),
    (re.compile(r"1\s*year|\b1\s*yr", re.I), "1yr"),
    (re.compile(r"2\s*year|\b2\s*yr", re.I), "2yr"),
    (re.compile(r"3\s*year|\b3\s*yr", re.I), "3yr"),
    (re.compile(r"4\s*year|\b4\s*yr", re.I), "4yr"),
    (re.compile(r"5\s*year|\b5\s*yr", re.I), "5yr"),
]
_RATE_RE = re.compile(r"(\d{1,2}\.\d{1,2})\s*%?")


def normalise_term(header: str) -> str | None:
    for pat, label in _TERM_PATTERNS:
        if pat.search(header):
            return label
    return None


def _parse_rate(cell: str) -> float | None:
    m = _RATE_RE.search(cell.replace(",", "."))
    if not m:
        return None
    val = float(m.group(1))
    # Plausible NZ mortgage rate band; reject stray numbers.
    return val / 100 if 1.0 <= val <= 15.0 else None


def parse_rates_html(html: str) -> list[dict]:
    """Extract (bank, term_label, rate) rows from an interest.co.nz rates table."""
    tree = HTMLParser(html)
    out: list[dict] = []
    for table in tree.css("table"):
        rows = table.css("tr")
        if not rows:
            continue
        # Build column->term map from the header row.
        header_cells = rows[0].css("th") or rows[0].css("td")
        col_terms: dict[int, str] = {}
        for idx, c in enumerate(header_cells):
            term = normalise_term(c.text(strip=True))
            if term:
                col_terms[idx] = term
        if not col_terms:
            continue
        for row in rows[1:]:
            cells = row.css("td")
            if len(cells) < 2:
                continue
            bank = cells[0].text(strip=True)
            if not bank or len(bank) > 60:
                continue
            for idx, term in col_terms.items():
                if idx < len(cells):
                    rate = _parse_rate(cells[idx].text(strip=True))
                    if rate is not None:
                        out.append({"bank": bank, "term_label": term, "rate": rate})
    return out


def scrape(timeout: float = 20.0) -> list[dict]:
    """Fetch and parse current rates. Returns [] on any failure."""
    try:
        r = httpx.get(
            RATES_URL,
            timeout=timeout,
            headers={"User-Agent": "HouseScout/0.1 (personal use)"},
            follow_redirects=True,
        )
        r.raise_for_status()
        return parse_rates_html(r.text)
    except Exception as exc:  # noqa: BLE001
        log.warning("interest.co.nz rate scrape failed: %s", exc)
        return []
