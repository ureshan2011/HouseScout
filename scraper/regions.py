"""The market HouseScout covers — a catalogue of NZ districts, not one hardcoded city.

Every scraper URL in this project used to end in ``canterbury/christchurch-city``,
written into the middle of three different modules. Widening the search meant editing
source in three places and redeploying, which is why the app had quietly become a
Christchurch-only tool despite nothing about the pipeline being Christchurch-specific.

This module makes coverage *data*. A district is a row here; selecting which rows to
scrape is an environment variable (``SCRAPE_REGIONS``) or a CLI argument, and the
selected districts are tagged onto every listing so the UI can filter by them.

Every slug below was verified against realestate.co.nz's live search by
``scripts/verify_regions.py`` before being committed — not merely "the page loaded",
but "the page returned something *different* from the whole region and from the
site's nationwide fallback". That distinction matters: the site answers an
unrecognised location with **HTTP 200 and the nationwide default results**, so a
wrong slug does not fail, it silently mislabels real listings with a district they
did not come from. Re-run the verifier whenever this table is edited.

Slugs that check caught, and which a reasonable guess gets wrong:
``manawatu-whanganui`` (not ``manawatu-wanganui``), ``nelson-bays`` (Nelson and
Tasman are districts inside it, not regions), ``central-otago-lakes-district``
(Queenstown and Wānaka are not under ``otago``), and the Auckland legacy councils,
which need the ``-city`` suffix (``north-shore-city``, not ``north-shore``).

Selection syntax (``SCRAPE_REGIONS``)
-------------------------------------
    christchurch-city                  one district by key
    christchurch-city,selwyn           several
    canterbury                         every district in a region
    island:south                       every district in an island
    all                                the whole country
    (unset)                            DEFAULT_REGION_KEYS

Scraping the whole country is the *option*, not the default: 59 locations is 59x the
requests, and the polite throttle in ``base.Throttle`` is there for a reason.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

__all__ = [
    "Region",
    "REGIONS",
    "DEFAULT_REGION_KEYS",
    "get_region",
    "resolve_regions",
    "regions_from_env",
    "region_choices",
]


@dataclass(frozen=True)
class Region:
    """One searchable district.

    ``key`` is the stable public identifier: it appears in ``SCRAPE_REGIONS``, on every
    scraped listing as ``region``, and in the frontend's region filter. District slugs
    are unique across the country, so the key needs no region prefix.
    """

    key: str  # "christchurch-city"
    name: str  # "Christchurch"
    region: str  # realestate.co.nz region segment: "canterbury"
    region_name: str  # "Canterbury"
    island: str  # "north" | "south"
    # The district segment, or "" for a region searched as a whole. Four regions have
    # no usable district split — Gisborne, Marlborough, Coromandel and the Central
    # Otago/Lakes district each return their entire region for every district slug
    # tried — so they are searched at region level rather than shipping a district
    # slug that pretends to narrow and does not.
    district: str = ""

    @property
    def label(self) -> str:
        """Human label for menus: 'Christchurch, Canterbury'."""
        return self.name if self.name == self.region_name else f"{self.name}, {self.region_name}"

    @property
    def path(self) -> str:
        """The site's location path: 'canterbury/christchurch-city', or just 'gisborne'."""
        return f"{self.region}/{self.district}" if self.district else self.region


def _r(name: str, region: str, district: str, region_name: str, island: str) -> Region:
    """A district inside a region. The district slug is the public key."""
    return Region(
        key=district,
        name=name,
        region=region,
        district=district,
        region_name=region_name,
        island=island,
    )


def _whole(name: str, region: str, island: str) -> Region:
    """A region with no usable district split — searched as a whole."""
    return Region(key=region, name=name, region=region, region_name=name, island=island)


# Ordered north to south. Every row below passed scripts/verify_regions.py.
_ALL: list[Region] = [
    _r("Far North", "northland", "far-north", "Northland", "north"),
    _r("Whangārei", "northland", "whangarei", "Northland", "north"),
    _r("Kaipara", "northland", "kaipara", "Northland", "north"),
    _r("Rodney", "auckland", "rodney", "Auckland", "north"),
    _r("North Shore", "auckland", "north-shore-city", "Auckland", "north"),
    _r("Waitākere", "auckland", "waitakere-city", "Auckland", "north"),
    _r("Auckland City", "auckland", "auckland-city", "Auckland", "north"),
    _r("Manukau", "auckland", "manukau-city", "Auckland", "north"),
    _r("Papakura", "auckland", "papakura", "Auckland", "north"),
    _r("Franklin", "auckland", "franklin", "Auckland", "north"),
    _whole("Coromandel", "coromandel", "north"),
    _r("Hauraki", "waikato", "hauraki", "Waikato", "north"),
    _r("Waikato District", "waikato", "waikato", "Waikato", "north"),
    _r("Hamilton", "waikato", "hamilton-city", "Waikato", "north"),
    _r("Waipā", "waikato", "waipa", "Waikato", "north"),
    _r("Matamata-Piako", "waikato", "matamata-piako", "Waikato", "north"),
    _r("South Waikato", "waikato", "south-waikato", "Waikato", "north"),
    _r("Tauranga", "bay-of-plenty", "tauranga", "Bay of Plenty", "north"),
    _r("Western Bay of Plenty", "bay-of-plenty", "western-bay-of-plenty", "Bay of Plenty", "north"),
    _r("Rotorua", "bay-of-plenty", "rotorua", "Bay of Plenty", "north"),
    _r("Whakatāne", "bay-of-plenty", "whakatane", "Bay of Plenty", "north"),
    _r("Taupō", "central-north-island", "taupo", "Central North Island", "north"),
    _whole("Gisborne", "gisborne", "north"),
    _r("Napier", "hawkes-bay", "napier-city", "Hawke's Bay", "north"),
    _r("Hastings", "hawkes-bay", "hastings", "Hawke's Bay", "north"),
    _r("Central Hawke's Bay", "hawkes-bay", "central-hawkes-bay", "Hawke's Bay", "north"),
    _r("New Plymouth", "taranaki", "new-plymouth", "Taranaki", "north"),
    _r("South Taranaki", "taranaki", "south-taranaki", "Taranaki", "north"),
    _r("Whanganui", "manawatu-whanganui", "whanganui", "Manawatū-Whanganui", "north"),
    _r("Manawatū", "manawatu-whanganui", "manawatu", "Manawatū-Whanganui", "north"),
    _r("Palmerston North", "manawatu-whanganui", "palmerston-north-city", "Manawatū-Whanganui", "north"),
    _r("Horowhenua", "manawatu-whanganui", "horowhenua", "Manawatū-Whanganui", "north"),
    _r("Masterton", "wairarapa", "masterton", "Wairarapa", "north"),
    _r("Kāpiti Coast", "wellington", "kapiti-coast", "Wellington", "north"),
    _r("Porirua", "wellington", "porirua-city", "Wellington", "north"),
    _r("Upper Hutt", "wellington", "upper-hutt-city", "Wellington", "north"),
    _r("Lower Hutt", "wellington", "lower-hutt-city", "Wellington", "north"),
    _r("Wellington City", "wellington", "wellington-city", "Wellington", "north"),
    _r("Nelson", "nelson-bays", "nelson", "Nelson Bays", "south"),
    _r("Tasman", "nelson-bays", "tasman", "Nelson Bays", "south"),
    _whole("Marlborough", "marlborough", "south"),
    _r("Buller", "west-coast", "buller", "West Coast", "south"),
    _r("Grey", "west-coast", "grey", "West Coast", "south"),
    _r("Westland", "west-coast", "westland", "West Coast", "south"),
    _r("Hurunui", "canterbury", "hurunui", "Canterbury", "south"),
    _r("Waimakariri", "canterbury", "waimakariri", "Canterbury", "south"),
    _r("Christchurch", "canterbury", "christchurch-city", "Canterbury", "south"),
    _r("Selwyn", "canterbury", "selwyn", "Canterbury", "south"),
    _r("Ashburton", "canterbury", "ashburton", "Canterbury", "south"),
    _r("Timaru", "canterbury", "timaru", "Canterbury", "south"),
    # Queenstown Lakes has no district slug that narrows this region — every variant
    # tried returned the whole region — so Queenstown is reached via the region row
    # or the Wānaka district, not via a slug that silently returns everything.
    _whole("Queenstown Lakes & Central Otago", "central-otago-lakes-district", "south"),
    _r("Wānaka", "central-otago-lakes-district", "wanaka", "Queenstown Lakes & Central Otago", "south"),
    _r("Central Otago", "central-otago-lakes-district", "central-otago", "Queenstown Lakes & Central Otago", "south"),
    _r("Waitaki", "otago", "waitaki", "Otago", "south"),
    _r("Dunedin", "otago", "dunedin-city", "Otago", "south"),
    _r("Clutha", "otago", "clutha", "Otago", "south"),
    _r("Gore", "southland", "gore", "Southland", "south"),
    _r("Invercargill", "southland", "invercargill-city", "Southland", "south"),
    _r("Southland District", "southland", "southland", "Southland", "south"),
]

REGIONS: dict[str, Region] = {r.key: r for r in _ALL}

# What a build scrapes when nothing says otherwise. Christchurch stays the default so
# an unconfigured deploy behaves exactly as it did before this change.
DEFAULT_REGION_KEYS: tuple[str, ...] = ("christchurch-city",)


def get_region(key: str) -> Region | None:
    return REGIONS.get(key.strip().lower())


def region_choices() -> list[dict]:
    """Serialisable catalogue for the frontend / API (`/api/regions`)."""
    return [
        {
            "key": r.key,
            "name": r.name,
            "label": r.label,
            "region": r.region,
            "region_name": r.region_name,
            "island": r.island,
        }
        for r in _ALL
    ]


def resolve_regions(spec: str | None) -> list[Region]:
    """Turn a selection string into Region rows, in catalogue (north→south) order.

    Unknown tokens are skipped rather than raising: a typo in a CI environment variable
    should narrow the scrape, not fail the build with no listings at all. An empty or
    entirely unrecognised spec falls back to ``DEFAULT_REGION_KEYS``.
    """
    if spec is None or not spec.strip():
        return [REGIONS[k] for k in DEFAULT_REGION_KEYS]

    tokens = [t.strip().lower() for t in spec.replace(";", ",").split(",") if t.strip()]
    selected: dict[str, Region] = {}

    for token in tokens:
        if token in ("all", "*", "nz", "nationwide"):
            selected.update(REGIONS)
            continue
        if token.startswith("island:"):
            island = token.split(":", 1)[1].strip()
            for r in _ALL:
                if r.island == island:
                    selected[r.key] = r
            continue
        if token in REGIONS:
            selected[token] = REGIONS[token]
            continue
        # A region name selects every district inside it ("canterbury" -> 5 districts).
        matched = [r for r in _ALL if r.region == token]
        for r in matched:
            selected[r.key] = r

    if not selected:
        return [REGIONS[k] for k in DEFAULT_REGION_KEYS]
    # Preserve catalogue order so output is deterministic regardless of spec order.
    return [r for r in _ALL if r.key in selected]


def regions_from_env(var: str = "SCRAPE_REGIONS") -> list[Region]:
    return resolve_regions(os.environ.get(var))
