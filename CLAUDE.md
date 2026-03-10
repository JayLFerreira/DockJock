# DockJock — Claude Code Instructions

## Project
Single-user macro/calorie tracking web app with natural language food entry via OpenAI.
Deployed via Docker on Windows, accessible at `http://dockjock:8080` or `http://localhost:8080`.

## Deployment
After any code change, rebuild with:
```
/dbuild
```
This is a Claude Code skill (`.claude/skills/dbuild/`) that runs `docker-compose down && docker-compose up -d --build`, then tails logs to confirm clean startup.

To restart without rebuilding: `drestart` (PowerShell alias in `$PROFILE`)

## Rules

- **Never auto-commit.** Only commit when explicitly asked.
- **Never use browser popups** (`alert`, `confirm`, `prompt`). Always use in-app web modals.
- **Never create new files** unless absolutely necessary. Prefer editing existing ones.
- **No over-engineering.** Only make changes directly requested or clearly required.
- **No backwards-compat shims.** If something is unused, delete it cleanly.

## Tech Stack
- **Backend**: Python + FastAPI + SQLAlchemy + SQLite (`data/dockjock.db`)
- **Frontend**: Vanilla JS + HTML + CSS (no frameworks), served by Nginx
- **Auth**: HTTP Basic Auth (username ignored, password only) via `Authorization: Basic base64(:password)`
- **AI**: OpenAI API (gpt-4o-mini default) for natural language food parsing
- **Infra**: Docker Compose — backend on :8000, frontend/nginx on :80

## File Structure
```
macro-tracker/
├── backend/
│   ├── main.py           # All FastAPI routes
│   ├── database.py       # SQLAlchemy models + init_db() + migrations
│   ├── openai_service.py # OpenAI parsing + SQLite food cache
│   └── requirements.txt
├── frontend/
│   ├── index.html        # Single-page app (all HTML, all modals)
│   ├── app.js            # All frontend logic (vanilla JS)
│   ├── styles.css        # All styles
│   └── nginx.conf        # Reverse proxy to backend
├── .claude/skills/dbuild/ # /dbuild Claude Code skill
├── data/                 # SQLite volume (dockjock.db) — never delete
├── docker-compose.yml
└── .env                  # OPENAI_API_KEY, ADMIN_PASSWORD, PORT — never commit
```

## Architecture Notes

### Database Schema Evolution
New columns are added via `PRAGMA table_info()` checks + `ALTER TABLE ADD COLUMN` inside `init_db()`.
Never recreate tables or use `Base.metadata.drop_all()`.

### Frontend Patterns
- Single-page app — all pages are `<div id="*-page">` toggled with `display: none/block`
- `navigateToPage(page)` handles all page switching
- `window.currentEntries` — today's food entries cache
- `window.savedMealsData` — saved meals cache (includes full `items` array for builder)
- `userSettings` global — holds all user prefs, reloaded after any settings save
- Progress rings drawn on canvas via `drawProgressRings()`
- Units: height stored as cm (displayed as ft/in), weight as kg (displayed as lbs), water as ml (displayed as cups, 1 cup = 240ml)
- Dark mode: `data-theme="dark"` on `<body>`, toggled via `toggleTheme()`, persisted in `localStorage.theme`
- Midnight watcher: `startMidnightWatcher()` checks date every 60s, calls `loadTodayData()` on rollover
- Notifications: `localStorage.notifPrefs` `{ weighIn, dailySummary, summaryTime }` — browser Notification API

### OpenAI Food Parsing (`openai_service.py`)
- AI is asked for `total_nutrition` only (exact totals for the amount typed, not per-unit)
- Backend derives `per_unit = total / quantity` in Python (`_derive_per_unit()`) — avoids AI math errors
- Food cache key: `food_name|unit` for weight/volume units (unit-sensitive set `UNIT_SENSITIVE`)
- Cache stores per-unit values; lookup multiplies by quantity at query time

### API Conventions
- All protected routes use `Authorization: Basic btoa(':' + authPassword)` header
- `PUT /api/user/settings` accepts partial payload (all fields Optional)
- Food entries: `source_meal` field shows which saved meal an entry came from (null if typed directly)
- `GET /api/food/week` — returns entries + `days` count for weekly micros view
- `GET /api/food/export/csv` — full history export
- `GET /api/weight/today` / `POST /api/weight/log` — weigh-in tracking

### Micronutrients Page
- 22 micros tracked, grouped Vitamins / Minerals
- Row layout: `Label | Bar (capped 42% width) | % of RDA | Amount / Goal`
- Color: green ≥90%, orange ≥30%, red <30% (reversed for sodium upper-limit)
- `microsCurrentTotals` global holds aggregated values for AI analysis

## Phase Status
- Phase 1: Login, UI, Docker ✅
- Phase 2: OpenAI food parsing, food log, water tracking, saved meals ✅
- Phase 3: Settings page, profile card, Macro Wizard, Meal Builder ✅
- Phase 4: Manual food entry modal, micronutrients page + RDA tracking ✅
- Phase 5: History/calendar, daily summaries, CSV export, charts ✅
- Phase 6: Dark mode, midnight reset, browser notifications ✅ — mobile/responsive ⬜
