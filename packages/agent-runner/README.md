# @pixel-org/agent-runner

Invokes agent CLIs from the orchestrator. Sets `PIXEL_AGENT_ROLE` and optionally `PIXEL_VISIBLE_WORK` so the agent can follow role behavior and see report work.

- **Orchestrator** (e.g. backend): decides which agent, role, and task; calls `runAgent()`.
- **This package**: spawns the CLI with env and task; returns stdout/stderr/exit code.

## Cursor Agent CLI (current)

For `provider: "cursor"` we use the **Cursor Agent** CLI (`agent -h`):

- **Command:** `agent`
- **Workspace:** Pass `cwd` = the **agent’s own dir** (e.g. `~/.pixel-org/<uuid>-ceo/`). The CLI uses `--workspace <cwd>`, so that agent’s **MCP and skills** are loaded from that workspace (`.cursor/mcp.json` or `.claude/mcp.json`, plus `.agents/skills/`).
- **Args:** `--print`, `--trust`, `-f`, `--workspace <cwd>`, `--model` &lt;id&gt; (from `model`, default `"auto"`; same value as `PIXEL_MODEL`), then the **task** as the prompt. If you pass **`visibleWork`** (e.g. for CEO to review Engineer), we add **`--sandbox disabled`** so the agent can **read paths outside its workspace** (the report’s artifact dirs, e.g. `~/.pixel-org/<uuid>-engineer/project_1/artifacts/`). Those paths in `PIXEL_VISIBLE_WORK` are **absolute**, so the CEO (running in `/path/to/ceo`) can read the Engineer’s work at `/path/to/engineer/project_1/artifacts`.

Example CEO review run: `cwd` = CEO agent dir, `visibleWork` = from GET /agents/1/visible-work (includes Engineer’s artifact paths). Runner invokes: `agent --print --trust -f --workspace /path/to/ceo --model auto --sandbox disabled "Review…"`. The CEO loads MCP/skills from their dir and can read the Engineer’s paths from env.

## Troubleshooting: `HTTP 504`, `[unavailable]`, or exit code 1

Orchestration runs the **`agent`** binary (Cursor Agent CLI). If stderr contains **504**, **502**, **503**, or **unavailable**, that almost always means **Cursor’s cloud API** (or the route to it) timed out or was unavailable — **not** the Pixel backend (`PIXEL_BACKEND_URL` on port 3000). The backend only spawns the CLI and forwards stderr into the thread when the run fails.

What to check:

1. **Cursor / `agent` CLI** – logged in, not rate-limited, service not degraded.
2. **Network / VPN / proxy** – intermittent timeouts to Cursor.
3. **Machine running the backend** – must have `agent` on `PATH` and a working Cursor Agent setup for the agent workspace directory.

Pixel’s own HTTP API is separate; MCP tools in the agent use `PIXEL_BACKEND_URL` inside the CLI process — a 504 in stderr is still overwhelmingly from **upstream Cursor**, not from `fetch` to your backend failing (those would usually show as connection errors to `localhost:3000` with different wording).
