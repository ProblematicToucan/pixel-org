# @pixel-org/agent-runner

Invokes agent CLIs from the orchestrator. Sets `PIXEL_AGENT_ROLE` and optionally `PIXEL_VISIBLE_WORK` so the agent can follow role behavior and see report work.

- **Orchestrator** (e.g. backend): decides which agent, role, and task; calls `runAgent()`.
- **This package**: spawns the CLI with env and task; returns stdout/stderr/exit code.

## Cursor Agent CLI (current)

For `provider: "cursor"` we use the **Cursor Agent** CLI (`agent -h`):

- **Command:** `agent`
- **Workspace:** Pass `cwd` = the **per-project workspace dir** (e.g. `~/.pixel-org/<uuid>-ceo/<project-id>/`). The backend prepares runtime files in that dir: `AGENTS.md` is symlinked from agent home, while MCP config and `.agents` are copied locally into the project workspace. Then the CLI uses `--workspace <cwd>` so **MCP, skills, and shell cwd** align with the Pixel project folder. For ad-hoc runs without that layout, `cwd` can still be the agent’s own dir.
- **Args:** `--print`, `--trust`, `-f`, `--workspace <cwd>`, `--model` &lt;id&gt; (from `model`, default `"auto"`; same value as `PIXEL_MODEL`), then the **task** as the prompt. If you pass **`visibleWork`** (e.g. for CEO to review Engineer), we add **`--sandbox disabled`** so the agent can **read paths outside its workspace** (the report’s per-project dirs, e.g. `~/.pixel-org/<uuid>-engineer/project_1/` — repo, source, `artifacts/`, etc.). Those paths in `PIXEL_VISIBLE_WORK` are **absolute**, so the CEO can read the Engineer’s work at those paths.

Example CEO review run: `cwd` = CEO’s project workspace dir, `visibleWork` = from GET /agents/1/visible-work. Runner invokes: `agent --print --trust -f --workspace <that-dir> --model auto --sandbox disabled "Review…"`.

## Troubleshooting: `HTTP 504`, `[unavailable]`, or exit code 1

Orchestration runs the **`agent`** binary (Cursor Agent CLI). If stderr contains **504**, **502**, **503**, or **unavailable**, that almost always means **Cursor’s cloud API** (or the route to it) timed out or was unavailable — **not** the Pixel backend (`PIXEL_BACKEND_URL` on port 3000). The backend only spawns the CLI and forwards stderr into the thread when the run fails.

What to check:

1. **Cursor / `agent` CLI** – logged in, not rate-limited, service not degraded.
2. **Network / VPN / proxy** – intermittent timeouts to Cursor.
3. **Machine running the backend** – must have `agent` on `PATH` and a working Cursor Agent setup for the agent workspace directory.

Pixel’s own HTTP API is separate; MCP tools in the agent use `PIXEL_BACKEND_URL` inside the CLI process — a 504 in stderr is still overwhelmingly from **upstream Cursor**, not from `fetch` to your backend failing (those would usually show as connection errors to `localhost:3000` with different wording).
