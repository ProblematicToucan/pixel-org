# Contributing to pixel-org

This document explains how to work in this repository—whether you are a human contributor or an automated agent. For agent **workspace storage** layout (where MCP configs and artifacts live on disk), see [Agent workspace storage](README.md#agent-workspace-storage) in the root README.

## What this repo is

**pixel-org** is a **pnpm monorepo** for agent orchestration: an Express backend, a Vue 3 web UI, a shared **agent-runner** library, and an optional **Pixel MCP server** package.

| Package | Role |
|--------|------|
| [`packages/backend`](packages/backend) | REST API, orchestration, Drizzle + embedded PGlite (or external Postgres) |
| [`packages/web`](packages/web) | Vue 3 + Vite UI; dev server proxies `/api` → backend |
| [`packages/agent-runner`](packages/agent-runner) | Invokes agent CLIs with role/context (workspace dependency of backend) |
| [`packages/pixel-mcp-server`](packages/pixel-mcp-server) | MCP server + Pixel Context MCP App (builds a bundled HTML app) |

Root scripts run across all packages:

- `pnpm dev` — parallel `dev` in every package (backend, web, agent-runner watch, MCP server dev, etc.)
- `pnpm build` — build all packages
- `pnpm test` — tests in all packages (several packages still use placeholder tests)

## Prerequisites

- **Node.js** — use a current LTS that matches your team’s policy.
- **pnpm** — version is pinned in root `package.json` (`packageManager`). Install with [Corepack](https://nodejs.org/api/corepack.html) or match that version to avoid lockfile drift.

## First-time setup

1. **Install dependencies** (from repo root):

   ```bash
   pnpm install
   ```

2. **Environment** — copy the example env and adjust:

   ```bash
   cp .env.example .env
   ```

   The backend loads **`.env` from the repository root** (not from `packages/backend`). See [`.env.example`](.env.example) for `PORT`, optional `DATABASE_URL`, `AGENTS_STORAGE_PATH`, and MCP-related variables.

3. **Database** — default development uses embedded **PGlite** under `packages/backend/data` when `DATABASE_URL` is unset. After schema changes, generate and apply migrations from the backend package:

   ```bash
   cd packages/backend
   pnpm run db:generate   # after editing Drizzle schema
   pnpm run db:migrate
   ```

   Optional: set `DATABASE_URL` to use external Postgres instead.

## Git workflow

**Do not commit or push directly to `main`.** Use a separate branch for each change, then merge via pull request (or your team’s equivalent review process).

1. Update your local `main` (or the default branch) from the remote.
2. Create a branch with a short, descriptive name (e.g. `fix/login-redirect`, `feat/thread-filters`).
3. Commit your work on that branch and push it.
4. Open a **pull request** into `main` and get review before merge.

This applies to human contributors and to agents/automation: treat `main` as protected and integrate changes through branches + PRs unless project policy says otherwise.

## Local development

### Full stack (typical)

From the repo root, `pnpm dev` starts all packages that define `dev`. For a **minimal** UI + API loop you can use two terminals instead:

```bash
# Terminal 1
cd packages/backend && pnpm run dev

# Terminal 2
cd packages/web && pnpm run dev
```

- **API:** `http://localhost:3000` (or `PORT` from `.env`)
- **Web UI:** `http://localhost:5173` — Vite proxies `/api` to the backend (see [`packages/web/README.md`](packages/web/README.md))

### Package-specific notes

- **Backend:** `tsx watch`; TypeScript build via `pnpm run build` in `packages/backend`.
- **Web:** `VITE_API_URL=...` overrides the default proxy behavior when pointing at a remote API.
- **pixel-mcp-server:** has its own `dev` (watch + server); read that package’s `package.json` for `serve` / `stdio` entrypoints.

## Project conventions (for humans and agents)

1. **Scope changes to the task** — prefer small, focused diffs; avoid drive-by refactors in unrelated files.
2. **Match existing style** — TypeScript `module` resolution, imports, and patterns differ slightly per package; follow the nearest similar file.
3. **Read before writing** — especially API routes in `packages/backend/src` and shared types consumed by `packages/web`.
4. **Verify locally** — run `pnpm build` and relevant `pnpm dev` flows before considering work done; run backend migrations when the schema changes.
5. **Agent workspace data** — default agent files live under `~/.pixel-org` (not in git). Override with `AGENTS_STORAGE_PATH` for local testing; details in [Agent workspace storage](README.md#agent-workspace-storage).
6. **Branches** — use a dedicated branch and a pull request; do not push straight to `main` (see [Git workflow](#git-workflow)).

## Where to look

| Topic | Location |
|-------|----------|
| API & orchestration | `packages/backend/src` |
| DB schema & migrations | `packages/backend/src/db`, `packages/backend/drizzle` |
| Web routes & API client | `packages/web/src` |
| Agent CLI integration | `packages/agent-runner/src` |
| MCP server & app bundle | `packages/pixel-mcp-server` |

---

Questions or improvements to this doc are welcome via pull requests.
