# Pixel Org – Web UI (Vue 3)

Vue 3 + Vite + TypeScript frontend for the Pixel Org backend. Uses the REST API for agents, projects, threads, and messages.

## Run

From repo root:

```bash
# Terminal 1: backend
cd packages/backend && pnpm run dev

# Terminal 2: frontend (proxies /api to backend)
cd packages/web && pnpm run dev
```

Open http://localhost:5173. The Vite dev server proxies `/api` to `http://localhost:3000`, so no CORS config is needed when using the proxy.

To point at a different backend (e.g. production), set:

```bash
VITE_API_URL=https://your-backend.example.com pnpm run dev
```

## Scripts

- `pnpm run dev` – Vite dev server (port 5173)
- `pnpm run build` – Production build to `dist/`
- `pnpm run preview` – Serve `dist/` locally

## Views

- **Home** – Links to Agents and Projects
- **Agents** – List agents; for leads, “Visible work” shows self + reports’ artifact paths
- **Projects** – List projects, create new; open a project to see threads
- **Project** – Threads list (status badge + Board status control), filter by status, create thread (owner + optional initial status)
- **Thread** – Thread work-item status (Board), messages list, post as Board
