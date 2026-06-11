# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

象棋道 Xiangqidao — a Chinese chess (xiangqi) training system: tactics puzzles with SM-2 spaced repetition, ELO ratings, human-vs-engine play, game review/analysis, and an AI coach. Code comments, commit messages, and all UI text are in Chinese — follow that convention.

## Commands

### Backend (FastAPI, from `backend/`)

```bash
pip install -r requirements.txt
python -m app.importer.load app/importer/seed_puzzles.json   # seed the puzzle DB (first run)
uvicorn app.main:app --reload --port 8000
```

### Tests (from `backend/`; pytest is not in requirements.txt, install it separately)

```bash
python -m pytest tests/                          # all tests
python -m pytest tests/test_training.py          # one file
python -m pytest tests/test_training.py -k name  # one test
```

Tests do `sys.path.insert` themselves and build an in-memory SQLite engine, overriding the `get_db` dependency — no fixtures/conftest, copy the pattern from an existing test file.

### Frontend (React + Vite, from `frontend/`)

```bash
npm install
npm run dev     # http://localhost:5173, proxies /api to localhost:8000
npm run build
```

## Architecture

Two independent apps: `backend/app` (FastAPI) and `frontend/src` (React 18, no router library — navigation is tab state in `App.jsx`). The frontend talks to the backend only through `frontend/src/api.js`, a thin fetch wrapper that injects the Bearer token from localStorage.

### Backend layering

`routes/*` (HTTP) → `repository.py` (query helpers) → `models.py` (ORM) → `database.py` (engine/session/table creation). Keep business routes decoupled from raw ORM where a repository helper exists.

**No migration framework.** `database.py:_ensure_columns()` does lightweight "add missing column" migration for SQLite. When you add a column to an existing table in `models.py`, you must also add it to the `additions` dict there, or existing databases will break.

### Cross-cutting concepts

- **Move notation is UCI coordinates** (e.g. `h2e2`): file `a..i`, rank `0..9` with red at the bottom; matches Pikafish. Multi-step puzzle solutions alternate player/opponent moves (even indices = player).
- **Xiangqi rules are implemented twice** and must stay consistent: backend `app/xiangqi_utils.py` (+ `app/importer/verify_mate.py` for check/mate validation) and frontend `src/xiangqi.js`.
- **User scoping**: `user_id` is a username *string*, with `'default'` for anonymous/guest data. Puzzles with `user_id='default'` are the public library; other values are private (e.g. auto-generated from a user's game blunders). Most queries must filter on this.
- **Auth** (`app/auth.py`) is stdlib-only: PBKDF2 password hashing + HMAC-signed tokens (no JWT library). First registered user becomes admin (or `XQ_ADMIN` env var). `XQ_SECRET` signs tokens.
- **Engine fallback chain** for play/eval: cloud opening book (`app/cloudbook.py`, with TTL cache + circuit breaker) → Pikafish binary (looked up in `data/engine/` first, then PATH — `app/engine.py:find_engine`) → built-in negamax (`app/play_engine.py`). Everything must keep working with no Pikafish installed. Browser-side Pikafish WASM (`frontend/src/localEngine.js`) is optional and degrades to the server.
- **LLM features** (coach narrative, review reports, explanations) use DeepSeek via `app/llm.py`; key comes from admin settings in DB (preferred) or `DEEPSEEK_API_KEY`. All LLM features are optional — rule-engine output in `app/coach.py` must work without a key.
- **Router registration order matters** in `main.py`: `analysis` must be registered before `games` (otherwise `/games/{id}/analyze` is captured by games' `DELETE /{id}`).
- **Rate limiting** uses slowapi keyed by client IP (`app/ratelimit.py`); security-sensitive events log to the `xiangqidao.security` logger (`app/security_log.py`).

### Configuration

All backend config is via `XQ_*` environment variables (`XQ_DB_URL`, `XQ_SECRET`, `XQ_ENV`, `XQ_ORIGINS`, `XQ_ADMIN`, `XQ_ENGINE_DIR`) — see the README table. `XQ_ENV=production` enforces a real secret and disables `/docs`.

### Frontend notes

- One top-level component per tab (`Trainer`, `Play`, `Games`, `Stats`, `Challenge`, `Coach`, `Admin`); cross-tab jumps (e.g. "practice this puzzle", "review this game") are passed as props from `App.jsx`.
- `vite.config.js` sets COOP/COEP headers because the optional multi-threaded WASM engine needs `SharedArrayBuffer`; production deployments need the same headers.
- The app is a PWA (installable, local notifications for due reviews via `reminders.js`).
