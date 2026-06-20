"""Tests for the interest.co.nz rate-table parser (no network)."""
from __future__ import annotations

import sys
from pathlib import Path

# Make the standalone `scraper` package importable from the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scraper.rates import normalise_term, parse_rates_html  # noqa: E402

SAMPLE_HTML = """
<table>
  <tr><th>Bank</th><th>6 months</th><th>1 year</th><th>2 years</th><th>3 years</th></tr>
  <tr><td>ASB</td><td>4.49%</td><td>4.65%</td><td>5.25%</td><td>5.35%</td></tr>
  <tr><td>BNZ</td><td>4.49%</td><td>4.65%</td><td>5.19%</td><td>5.39%</td></tr>
  <tr><td>Westpac</td><td>4.55%</td><td>4.69%</td><td>5.19%</td><td>5.29%</td></tr>
</table>
"""


def test_normalise_term():
    assert normalise_term("6 months") == "6mo"
    assert normalise_term("1 year") == "1yr"
    assert normalise_term("2 years") == "2yr"
    assert normalise_term("Floating") == "floating"
    assert normalise_term("Bank") is None


def test_parse_rates_html_extracts_rows():
    rows = parse_rates_html(SAMPLE_HTML)
    # 3 banks x 4 terms = 12 rows
    assert len(rows) == 12
    asb_1yr = [r for r in rows if r["bank"] == "ASB" and r["term_label"] == "1yr"]
    assert asb_1yr and abs(asb_1yr[0]["rate"] - 0.0465) < 1e-9
    bnz_2yr = [r for r in rows if r["bank"] == "BNZ" and r["term_label"] == "2yr"]
    assert bnz_2yr and abs(bnz_2yr[0]["rate"] - 0.0519) < 1e-9


def test_parse_rates_ignores_implausible_numbers():
    html = "<table><tr><th>Bank</th><th>1 year</th></tr><tr><td>X</td><td>99.0%</td></tr></table>"
    assert parse_rates_html(html) == []
