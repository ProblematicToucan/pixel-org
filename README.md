# pixel-org

A **pnpm monorepo** for **agent orchestration**: REST API, Vue 3 web app, shared agent-runner library, and an optional MCP server that exposes Pixel tools and UI.

## Roadmap

**Next milestone — pixelated, game-like UI:** we plan to evolve the experience toward a **pixel-art / office-simulation** feel: agents as visible “characters,” spatial or playful presentation of work, and a more tactile interface than a typical admin dashboard.

For **visual and interaction reference** (multi-agent office metaphor, pixel aesthetic, live activity), see the open-source [**Pixel Agents**](https://github.com/pablodelucca/pixel-agents) VS Code extension — *Pixel office* — which turns agent activity into a manageable pixel scene. pixel-org is a separate codebase; that project is **inspiration and UX reference**, not a dependency.

## Packages

| Package | Description |
|--------|-------------|
| [`packages/backend`](packages/backend) | Express API, orchestration, Drizzle + PGlite or Postgres |
| [`packages/web`](packages/web) | Vue 3 + Vite UI (`/api` proxied to the backend in dev) |
| [`packages/agent-runner`](packages/agent-runner) | Invokes agent CLIs with role and context |
| [`packages/pixel-mcp-server`](packages/pixel-mcp-server) | MCP server + Pixel Context MCP App |

## Quick start

```bash
pnpm install
cp .env.example .env
pnpm dev
```

- **API:** `http://localhost:3000` (override with `PORT` in `.env`)
- **Web UI:** `http://localhost:5173`

Setup details, database migrations, branching, and conventions are in [**CONTRIBUTING.md**](CONTRIBUTING.md).

## Agent workspace storage

By default, agent files live under **`~/.pixel-org`** (not in this repo), so orchestrated runs do not use the monorepo root as the Cursor workspace. Layout:

- **Agent home** (`{id}-{role-slug}/`): canonical **`AGENTS.md`**, **`.cursor`/`.claude` `mcp.json`**, and **`.agents/skills/`** — one set per agent, updated when you save the agent in the app or on each orchestrated run.
- **Per Pixel project** (`…/{agent}/{project-id}/`): the backend creates **`artifacts/`** and a runtime-safe workspace for the Cursor Agent CLI (`--workspace` + shell cwd). `AGENTS.md` is symlinked from agent home, while MCP config (`.cursor/.claude mcp.json`) and `.agents` skills are materialized as local files/directories inside the project workspace.

Override the root with **`AGENTS_STORAGE_PATH`** (e.g. for local development).

### Layout

```text
~/.pixel-org/   # default; or $AGENTS_STORAGE_PATH
├── 1-ceo/
│   ├── AGENTS.md               # canonical persona (source for project symlink below)
│   ├── .cursor/mcp.json
│   ├── .agents/skills/
│   ├── <project-id>/           # Cursor --workspace + cwd for runs on this project
│   │   ├── AGENTS.md -> ../../AGENTS.md
│   │   ├── .cursor/mcp.json    # copied from agent home (local file)
│   │   ├── .agents/skills/     # copied from agent home (local dir)
│   │   └── artifacts/          # deliverables for this project
│   └── <other-project-id>/
│       └── ...
├── 3-engineer/
│   └── ...
└── ...
```

- **Agent directory:** `{id}-{role-slug}` (e.g. `1-ceo`, `3-engineer`).
- **Canonical MCP/skills:** under the agent home. In `mcp.json`, set `PIXEL_BACKEND_URL` and `PIXEL_AGENT_ID`; optionally add **`OPENAI_API_KEY`** for Mem0 OSS (`pixel_get_context`, `pixel_store_memory`).
- **Project directory:** `AGENTS.md` symlink + local MCP/skills copy + **`artifacts/`**; orchestration also sets env **`PIXEL_PROJECT_WORKSPACE`** / **`PIXEL_PROJECT_ARTIFACTS`** on the CLI process.

Override the root with env: `AGENTS_STORAGE_PATH=/path/to/parent` (agent dirs are created inside that path).

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) — use a **feature branch** and pull requests; avoid pushing directly to `main`.

## License

[MIT](LICENSE)
