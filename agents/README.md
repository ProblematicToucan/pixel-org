# Agents storage (file-based)

By default, agent workspaces live under **`~/.pixel-org`** (not in this repo), so the agent CLI does not run git or write files in the monorepo root. One directory per agent; MCP and skills are **per agent** (shared across projects); each project dir holds **artifacts only**.

Override with **`AGENTS_STORAGE_PATH`** (e.g. to use a folder inside this repo for development).

## Layout

```
~/.pixel-org/   # default; or $AGENTS_STORAGE_PATH
├── 1-CEO/
│   ├── .cursor/
│   │   ├── mcp.json          # MCP config for this agent (shared across projects)
│   ├── .agents/
│   │   └── skills/           # skills config for this agent (shared across projects)
│   ├── project_1/
│   │   └── artifacts/        # project 1 outputs
│   └── project_2/
│       └── artifacts/        # project 2 outputs
├── 2-CTO/
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

- **Agent directory:** `{id}-{role-slug}` (e.g. `1-CEO`, `3-engineer`).
- **At agent level:** `.cursor/mcp.json` (or `.claude/mcp.json`) and `.agents/skills/` – one set per agent, reused for all their projects. In `mcp.json`, set `PIXEL_BACKEND_URL` and `PIXEL_AGENT_ID`; optionally add **`OPENAI_API_KEY`** for Mem0 OSS memory tools (`pixel_get_context`, `pixel_store_memory`).
- **Project directory:** only `artifacts/` – project = workspace for that agent’s outputs.

Override the root with env: `AGENTS_STORAGE_PATH=/path/to/parent` (agent dirs are created inside that path).
