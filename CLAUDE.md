# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

象棋道 Xiangqidao — a Chinese chess (xiangqi) training system: tactics puzzles with SM-2 spaced repetition, ELO ratings, human-vs-engine play, game review/analysis, and an AI coach. Code comments, commit messages, and all UI text are in Chinese — follow that convention.

## Commands

### Backend (FastAPI, from `backend/`)

```bash
uv sync
uv run python -m app
```

首次启动若公共题库为空，会自动导入 `backend/seeds/` 下的种子题库（`app/modules/puzzles/seeding.py`，`SEEDS_DIR` 可覆盖目录）；扩容/更新题库仍手动运行 `python -m app.modules.puzzles.importer.load <json路径>`。

### Tests (from `backend/`)

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

Two independent apps: `backend/app` (FastAPI) and `frontend/src` (React 18, no router library — navigation is tab state in `app/App.jsx`). Frontend HTTP access is centralized under `frontend/src/shared/api/`.

### Backend layering

`modules/*/router.py` (HTTP) → module services / `modules/puzzles/repository.py` → `core/models.py` → `core/database.py`; routers are registered in order by `app/routes.py`, and Pydantic request/response models live in each module's `schemas.py` (never inline in routers). `engine/` owns engine processes and protocol, while `integrations/` owns external services. Keep business APIs decoupled from raw ORM where a repository helper exists.

**Migrations use Alembic.** `backend/migrations/` (config in `backend/alembic.ini`) is the migration framework; app startup calls `migrations.upgrade_database()` via `database.init_db()`. Schema changes go in a new revision under `migrations/versions/` — do NOT add them to `database.py:_ensure_columns()`. That function (plus `_migrate_reviews_unique`) is legacy-only: it runs once from `_bootstrap_legacy_database()` when Alembic takes over a pre-Alembic database (existing tables but no `alembic_version` table), which is then stamped to baseline `202608310001`. Empty databases are built by the baseline revision.

### Cross-cutting concepts

- **Move notation is UCI coordinates** (e.g. `h2e2`): file `a..i`, rank `0..9` with red at the bottom; matches Pikafish. Multi-step puzzle solutions alternate player/opponent moves (even indices = player).
- **Xiangqi rules are implemented twice** and must stay consistent: backend `app/shared/xiangqi/` (including `validation.py`) and frontend `src/domain/xiangqi/`.
- **User scoping**: `user_id` is a username *string*, with `'default'` for anonymous/guest data. Puzzles with `user_id='default'` are the public library; other values are private (e.g. auto-generated from a user's game blunders). Most queries must filter on this.
- **Auth** (`app/modules/auth/service.py`) is stdlib-only: PBKDF2 password hashing + HMAC-signed tokens (no JWT library). First registered user becomes admin (or `ADMIN_USERNAME` env var). `SECRET_KEY` signs tokens.
- **Engine fallback chain** for play/eval: cloud opening book (`app/integrations/cloudbook.py`) → user-provided UCI engine (`app/engine/uci.py`) → built-in negamax (`app/modules/play/service.py`). Browser WASM lives under `frontend/src/domain/xiangqi/engine/` and must be imported by the user.
- **LLM features** live in `app/integrations/llm.py`; all are optional and the rule-based coach in `app/modules/coach/service.py` must work without a key.
- **Router registration order matters** in `app/routes.py`: game analysis must be registered before the game `/{id}` route.
- **Rate limiting** and security logging live under `app/core/`.

### Configuration

Backend config uses generic, unprefixed env vars — `HOST`/`PORT`, `DATABASE_URL`, `SECRET_KEY`, `APP_ENV`, `CORS_ORIGINS`, `ADMIN_USERNAME`, `TZ`, `XIANGQI_ENGINE`, `JIEQI_ENGINE`, `LLM_*`, … (see the README table) — read from the environment or a `backend/.env` file (template: `backend/.env.example`). `app/core/env.py` loads `.env` at package import (in `app/__init__.py`) before any module reads env vars; real environment variables take precedence, and loading is skipped under pytest. `APP_ENV=production` enforces a real secret and disables `/docs`.

### Frontend notes

- One feature directory per user-facing capability under `src/features/`; cross-feature jumps are orchestrated in `src/app/App.jsx`.
- `src/app/shells/` owns platform layout: `DesktopShell` for PC and the responsive `WebShell` for Web/Android. Keep authentication and page orchestration in `App.jsx`, not in a shell.
- `src/shared/api/` separates session storage, HTTP transport, resource endpoints, and the engine streaming protocol; feature pages must not call `fetch` directly.
- `vite.config.js` sets COOP/COEP headers because the optional multi-threaded WASM engine needs `SharedArrayBuffer`; production deployments need the same headers.
- The app is a PWA (installable, local notifications for due reviews via `features/today/useReminders.js`).
