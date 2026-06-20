"""Background scheduler: periodically refresh listings and rescore.

Disabled automatically in tests / when no scraper config is present so the API
stays lightweight. The scrape itself runs only if a scraper is implemented and
network/keys are available; otherwise it logs and skips.
"""
from __future__ import annotations

import logging

from apscheduler.schedulers.background import BackgroundScheduler

from .config import settings

log = logging.getLogger(__name__)
_scheduler: BackgroundScheduler | None = None


def _job() -> None:
    from .scraper_hook import run_scrape

    try:
        run_scrape(dry_run=False)
    except Exception as exc:  # noqa: BLE001
        log.warning("Scheduled scrape failed: %s", exc)


def start_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        return
    _scheduler = BackgroundScheduler(daemon=True)
    _scheduler.add_job(
        _job,
        "interval",
        hours=settings.scrape_interval_hours,
        id="scrape",
        next_run_time=None,  # don't run immediately on boot
    )
    _scheduler.start()
    log.info("Scheduler started (every %sh)", settings.scrape_interval_hours)


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=False)
        _scheduler = None
