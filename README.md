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

Setup details, database migrations, branching, and conventions are in [**CONTRIBUTING.md**](CONTRIBUTING.md). Agent workspace paths on disk are documented in [**agents/README.md**](agents/README.md).

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) — use a **feature branch** and pull requests; avoid pushing directly to `main`.

## License

[MIT](LICENSE)
