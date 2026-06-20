"""Pydantic request/response schemas for the API."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ImageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    url: str
    position: int


class EnrichmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    land_area_m2: float | None = None
    rateable_value: float | None = None
    estimate_value: float | None = None
    rental_estimate_weekly: float | None = None
    last_sold_price: float | None = None


class ScoreOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    match_score: float
    passes_filters: bool
    components: dict | None = None


class ListingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    source: str
    url: str | None = None
    address: str | None = None
    suburb: str | None = None
    lat: float | None = None
    lng: float | None = None
    price: float | None = None
    price_text: str | None = None
    bedrooms: int | None = None
    bathrooms: int | None = None
    car_spaces: int | None = None
    has_garage: bool = False
    land_area_m2: float | None = None
    floor_area_m2: float | None = None
    property_type: str | None = None
    description: str | None = None
    status: str = "active"
    images: list[ImageOut] = []
    enrichment: EnrichmentOut | None = None
    score: ScoreOut | None = None


class FinanceRequest(BaseModel):
    price: float
    deposit: float | None = None
    annual_rate: float | None = None
    term_years: int | None = None
    bedrooms: int | None = None
    weekly_rent: float | None = None
    occupancy: float = 1.0
    reinvest_boarder_income: bool = True


class ChatRequest(BaseModel):
    question: str
    limit: int = 12


class AdvisorRequest(BaseModel):
    question: str


class AIResponse(BaseModel):
    ok: bool
    content: str
    model: str | None = None


class SuburbOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    name: str
    median_price: float | None = None
    median_rent_weekly: float | None = None
    rental_yield: float | None = None
    growth_5yr_pct: float | None = None
    distance_cbd_km: float | None = None
    notes: str | None = None


class RateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    bank: str
    term_label: str
    rate: float
    observed_at: datetime
