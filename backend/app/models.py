"""SQLAlchemy ORM models.

Schema is user-id-aware (nullable) so moving to multi-user later only requires
adding auth + populating user_id, not a rewrite.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class Listing(Base):
    __tablename__ = "listings"
    __table_args__ = (UniqueConstraint("source", "source_id", name="uq_source_listing"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    source: Mapped[str] = mapped_column(String(40), index=True)
    source_id: Mapped[str] = mapped_column(String(120), index=True)
    url: Mapped[str | None] = mapped_column(Text)

    address: Mapped[str | None] = mapped_column(String(255))
    suburb: Mapped[str | None] = mapped_column(String(120), index=True)
    lat: Mapped[float | None] = mapped_column(Float)
    lng: Mapped[float | None] = mapped_column(Float)

    price: Mapped[float | None] = mapped_column(Float, index=True)
    price_text: Mapped[str | None] = mapped_column(String(120))
    bedrooms: Mapped[int | None] = mapped_column(Integer)
    bathrooms: Mapped[int | None] = mapped_column(Integer)
    car_spaces: Mapped[int | None] = mapped_column(Integer)
    has_garage: Mapped[bool] = mapped_column(Boolean, default=False)
    land_area_m2: Mapped[float | None] = mapped_column(Float)
    floor_area_m2: Mapped[float | None] = mapped_column(Float)
    property_type: Mapped[str | None] = mapped_column(String(40), index=True)

    listing_date: Mapped[datetime | None] = mapped_column(DateTime)
    description: Mapped[str | None] = mapped_column(Text)
    agent: Mapped[str | None] = mapped_column(String(160))
    status: Mapped[str] = mapped_column(String(20), default="active")

    first_seen: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    last_seen: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
    raw_json: Mapped[dict | None] = mapped_column(JSON)

    images: Mapped[list["ListingImage"]] = relationship(
        back_populates="listing", cascade="all, delete-orphan"
    )
    price_points: Mapped[list["PricePoint"]] = relationship(
        back_populates="listing", cascade="all, delete-orphan"
    )
    enrichment: Mapped["PropertyEnrichment | None"] = relationship(
        back_populates="listing", uselist=False, cascade="all, delete-orphan"
    )
    score: Mapped["Score | None"] = relationship(
        back_populates="listing", uselist=False, cascade="all, delete-orphan"
    )
    insights: Mapped[list["AIInsight"]] = relationship(
        back_populates="listing", cascade="all, delete-orphan"
    )


class ListingImage(Base):
    __tablename__ = "listing_images"
    id: Mapped[int] = mapped_column(primary_key=True)
    listing_id: Mapped[int] = mapped_column(ForeignKey("listings.id"), index=True)
    url: Mapped[str] = mapped_column(Text)
    position: Mapped[int] = mapped_column(Integer, default=0)
    listing: Mapped[Listing] = relationship(back_populates="images")


class PricePoint(Base):
    __tablename__ = "price_history"
    id: Mapped[int] = mapped_column(primary_key=True)
    listing_id: Mapped[int] = mapped_column(ForeignKey("listings.id"), index=True)
    price: Mapped[float] = mapped_column(Float)
    observed_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    listing: Mapped[Listing] = relationship(back_populates="price_points")


class PropertyEnrichment(Base):
    __tablename__ = "property_enrichment"
    id: Mapped[int] = mapped_column(primary_key=True)
    listing_id: Mapped[int] = mapped_column(ForeignKey("listings.id"), unique=True)
    linz_parcel_id: Mapped[str | None] = mapped_column(String(60))
    linz_title: Mapped[str | None] = mapped_column(String(60))
    land_area_m2: Mapped[float | None] = mapped_column(Float)
    rateable_value: Mapped[float | None] = mapped_column(Float)
    estimate_value: Mapped[float | None] = mapped_column(Float)
    rental_estimate_weekly: Mapped[float | None] = mapped_column(Float)
    last_sold_price: Mapped[float | None] = mapped_column(Float)
    last_sold_date: Mapped[datetime | None] = mapped_column(DateTime)
    hazard_flags: Mapped[dict | None] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
    listing: Mapped[Listing] = relationship(back_populates="enrichment")


class Suburb(Base):
    __tablename__ = "suburbs"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    median_price: Mapped[float | None] = mapped_column(Float)
    median_rent_weekly: Mapped[float | None] = mapped_column(Float)
    rental_yield: Mapped[float | None] = mapped_column(Float)
    growth_5yr_pct: Mapped[float | None] = mapped_column(Float)
    distance_cbd_km: Mapped[float | None] = mapped_column(Float)
    notes: Mapped[str | None] = mapped_column(Text)


class MortgageRate(Base):
    __tablename__ = "mortgage_rates"
    id: Mapped[int] = mapped_column(primary_key=True)
    bank: Mapped[str] = mapped_column(String(60), index=True)
    term_label: Mapped[str] = mapped_column(String(20))  # e.g. "1yr", "2yr"
    rate: Mapped[float] = mapped_column(Float)
    observed_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Score(Base):
    __tablename__ = "scores"
    id: Mapped[int] = mapped_column(primary_key=True)
    listing_id: Mapped[int] = mapped_column(ForeignKey("listings.id"), unique=True)
    match_score: Mapped[float] = mapped_column(Float, index=True)
    passes_filters: Mapped[bool] = mapped_column(Boolean, default=True)
    components: Mapped[dict | None] = mapped_column(JSON)
    computed_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
    listing: Mapped[Listing] = relationship(back_populates="score")


class AIInsight(Base):
    __tablename__ = "ai_insights"
    id: Mapped[int] = mapped_column(primary_key=True)
    listing_id: Mapped[int] = mapped_column(ForeignKey("listings.id"), index=True)
    kind: Mapped[str] = mapped_column(String(40), default="summary")
    content: Mapped[str] = mapped_column(Text)
    model: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    listing: Mapped[Listing] = relationship(back_populates="insights")


class Favorite(Base):
    __tablename__ = "favorites"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[str | None] = mapped_column(String(60), index=True)  # multi-user ready
    listing_id: Mapped[int] = mapped_column(ForeignKey("listings.id"), index=True)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
