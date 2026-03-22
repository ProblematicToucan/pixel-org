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

By default, agent workspaces live under **`~/.pixel-org`** (not in this repo), so the agent CLI does not run git or write files in the monorepo root. One directory per agent; MCP and skills are **per agent** (shared across projects); each project dir holds **artifacts only**.

Override with **`AGENTS_STORAGE_PATH`** (e.g. to use a folder inside this repo for development).

### Layout

```text
~/.pixel-org/   # default; or $AGENTS_STORAGE_PATH
├── 1-ceo/
│   ├── .cursor/
│   │   ├── mcp.json          # MCP config for this agent (shared across projects)
│   ├── .agents/
│   │   └── skills/           # skills config for this agent (shared across projects)
│   ├── project_1/
│   │   └── artifacts/        # project 1 outputs
│   └── project_2/
│       └── artifacts/        # project 2 outputs
├── 2-cto/
│   ├── .cursor/
│   │   ├── mcp.json
│   ├── .agents/
│   │   └── skills/
│   └── project_1/
│       └── artifacts/
├── 3-engineer/
│   ├── .cursor/
│   │   ├── mcp.json
│   ├── .agents/
│   │   └── skills/
│   └── ...
└── 4-marketing/
    ├── .cursor/
    │   ├── mcp.json
    ├── .agents/
    │   └── skills/
    └── ...
```

- **Agent directory:** `{id}-{role-slug}` (e.g. `1-ceo`, `3-engineer`).
- **At agent level:** `.cursor/mcp.json` (or `.claude/mcp.json`) and `.agents/skills/` – one set per agent, reused for all their projects. In `mcp.json`, set `PIXEL_BACKEND_URL` and `PIXEL_AGENT_ID`; optionally add **`OPENAI_API_KEY`** for Mem0 OSS memory tools (`pixel_get_context`, `pixel_store_memory`).
- **Project directory:** only `artifacts/` – project = workspace for that agent’s outputs.

Override the root with env: `AGENTS_STORAGE_PATH=/path/to/parent` (agent dirs are created inside that path).

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) — use a **feature branch** and pull requests; avoid pushing directly to `main`.

## License

[MIT](LICENSE)
