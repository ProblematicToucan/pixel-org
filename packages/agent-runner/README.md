# @pixel-org/agent-runner

Invokes agent CLIs from the orchestrator. Sets `PIXEL_AGENT_ROLE` and optionally `PIXEL_VISIBLE_WORK` so the agent can follow role behavior and see report work.

- **Orchestrator** (e.g. backend): decides which agent, role, and task; calls `runAgent()`.
- **This package**: spawns the CLI with env and task; returns stdout/stderr/exit code.

## Cursor Agent CLI (current)

For `provider: "cursor"` we use the **Cursor Agent** CLI (`agent -h`):

- **Command:** `agent`
- **Workspace:** Pass `cwd` = the **agent’s own dir** (e.g. `agents/1-ceo/`). The CLI uses `--workspace <cwd>`, so that agent’s **MCP and skills** are loaded from `cwd/.agents/` (e.g. `.agents/mcp.json`, `.agents/skills/`).
- **Args:** `--print`, `--trust`, `--workspace <cwd>`, then the **task** as the prompt. If you pass **`visibleWork`** (e.g. for CEO to review Engineer), we add **`--sandbox disabled`** so the agent can **read paths outside its workspace** (the report’s artifact dirs, e.g. `agents/3-engineer/project_1/artifacts/`). Those paths in `PIXEL_VISIBLE_WORK` are **absolute**, so the CEO (running in `/path/to/ceo`) can read the Engineer’s work at `/path/to/engineer/project_1/artifacts`.

Example CEO review run: `cwd` = CEO agent dir, `visibleWork` = from GET /agents/1/visible-work (includes Engineer’s artifact paths). Runner invokes: `agent --print --trust --workspace /path/to/ceo --sandbox disabled "Review…"`. The CEO loads MCP/skills from their dir and can read the Engineer’s paths from env.
