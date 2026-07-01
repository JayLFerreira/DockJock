import os
import httpx
from datetime import datetime, date, time as dtime
from typing import Optional
from sqlalchemy.orm import Session
from database import NotionCaloriesCache

NOTION_DATABASE_ID = "38fda51d736280d5a14cdfa5bfbcf4ab"
NOTION_API_BASE    = "https://api.notion.com/v1"
NOTION_VERSION     = "2022-06-28"

# Times (local) when Apple Fitness pushes new data to Notion
PULL_TIMES = [(12, 0), (17, 0), (21, 0), (23, 55)]


def _last_scheduled_pull() -> Optional[datetime]:
    """Return the datetime of the most recent scheduled pull that has already passed today."""
    now = datetime.now()
    today = now.date()
    last = None
    for h, m in PULL_TIMES:
        t = datetime.combine(today, dtime(h, m))
        if t <= now:
            last = t
    return last


async def _fetch_from_notion(date_str: str, token: str) -> Optional[float]:
    """Query Notion for all 'Daily' rows on date_str, return the MAX Calories value."""
    url = f"{NOTION_API_BASE}/databases/{NOTION_DATABASE_ID}/query"
    headers = {
        "Authorization": f"Bearer {token}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    }
    payload = {
        "filter": {
            "property": "Date",
            "date": {"equals": date_str},
        }
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        print(f"[notion] fetch failed for {date_str}: {exc}")
        return None

    values = []
    for page in data.get("results", []):
        props = page.get("properties", {})
        cal = props.get("Calories", {})
        if cal.get("type") == "number" and cal.get("number") is not None:
            values.append(cal["number"])

    return max(values) if values else None


async def get_calories_burned(date_str: str, db: Session, force: bool = False) -> Optional[float]:
    """Return calories burned for date_str, using the cache and the 4-pull schedule.

    force=True bypasses all staleness checks and always fetches fresh from Notion.
    """
    token = os.getenv("NOTION_TOKEN", "")
    if not token or token == "your_notion_integration_token_here":
        return None

    today_str = date.today().isoformat()
    cached = db.query(NotionCaloriesCache).filter(
        NotionCaloriesCache.date == date_str
    ).first()

    if not force:
        # Past dates: cache forever once fetched
        if date_str < today_str:
            if cached is not None:
                return cached.calories_burned
            # No cache for past date — fetch once and store
        else:
            # Today: return cached value if still fresh
            if cached is not None:
                last_pull = _last_scheduled_pull()
                if last_pull is None:
                    # Before the first pull of the day — cached value is best available
                    return cached.calories_burned
                if cached.fetched_at >= last_pull:
                    return cached.calories_burned
                # Cache predates last pull window — fall through to refresh
            else:
                # No cache yet today
                if _last_scheduled_pull() is None:
                    return None  # Nothing has been pushed to Notion yet today

    # Fetch from Notion
    burned = await _fetch_from_notion(date_str, token)

    if cached:
        cached.calories_burned = burned
        cached.fetched_at = datetime.utcnow()
    else:
        db.add(NotionCaloriesCache(date=date_str, calories_burned=burned))
    db.commit()

    return burned


def get_cached_range(dates: list[str], db: Session) -> dict[str, Optional[float]]:
    """Batch-read cached calories_burned for a list of date strings. No Notion API calls."""
    if not dates:
        return {}
    records = db.query(NotionCaloriesCache).filter(
        NotionCaloriesCache.date.in_(dates)
    ).all()
    return {r.date: r.calories_burned for r in records}
