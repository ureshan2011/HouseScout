"""LINZ Data Service enrichment — free, official, CC-BY licensed.

Resolves an address to its primary parcel and returns the land area (m2), which
reliably powers the "backyard" filter. Requires a free LINZ API key.

Datasets:
  * NZ Addresses (layer 105689 / WFS)
  * NZ Primary Parcels (layer 50772) — has `calc_area` / parcel geometry.

Docs: https://www.linz.govt.nz/products-services/data/linz-data-service
"""
from __future__ import annotations

import logging

import httpx

log = logging.getLogger(__name__)

LDS_WFS = "https://data.linz.govt.nz/services;key={key}/wfs"


class LinzClient:
    def __init__(self, api_key: str, timeout: float = 20.0):
        self.api_key = api_key
        self.timeout = timeout

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)

    def _wfs(self, params: dict) -> dict | None:
        if not self.enabled:
            return None
        url = LDS_WFS.format(key=self.api_key)
        base = {
            "service": "WFS",
            "version": "2.0.0",
            "request": "GetFeature",
            "outputFormat": "application/json",
            "count": "1",
        }
        base.update(params)
        try:
            r = httpx.get(url, params=base, timeout=self.timeout)
            r.raise_for_status()
            return r.json()
        except Exception as exc:  # noqa: BLE001
            log.warning("LINZ WFS request failed: %s", exc)
            return None

    def land_area_for_address(self, address: str) -> dict | None:
        """Best-effort: find the parcel containing an address and return its land area.

        Uses a CQL filter on the parcels layer by appellation/address text. The exact
        matching strategy can be refined per LINZ schema; kept defensive so failures
        never break the pipeline.
        """
        if not self.enabled or not address:
            return None
        # Primary parcels layer: filter where the address text appears in `appellation`.
        safe = address.replace("'", "''")
        data = self._wfs({
            "typeNames": "layer-50772",  # NZ Primary Parcels
            "cql_filter": f"appellation ILIKE '%{safe}%'",
        })
        if not data or not data.get("features"):
            return None
        props = data["features"][0].get("properties", {})
        area = props.get("calc_area") or props.get("survey_area")
        return {
            "land_area_m2": float(area) if area else None,
            "linz_parcel_id": str(props.get("id") or props.get("parcel_intent") or ""),
        }
