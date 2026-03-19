# Agents storage (file-based)

Agent data lives here alongside DB metadata. One directory per agent; MCP and skills are **per agent** (shared across projects); each project dir holds **artifacts only**.

## Layout

```
agents/
├── 1-CEO/
│   ├── .agents/
│   │   ├── mcp.json          # MCP config for this agent (shared across projects)
│   │   └── skills/           # skills config for this agent (shared across projects)
│   ├── project_1/
│   │   └── artifacts/        # project 1 outputs
│   └── project_2/
│       └── artifacts/        # project 2 outputs
├── 2-CTO/
│   ├── .agents/
│   │   ├── mcp.json
│   │   └── skills/
│   └── project_1/
│       └── artifacts/
├── 3-engineer/
│   ├── .agents/
│   │   ├── mcp.json
│   │   └── skills/
│   └── ...
└── 4-marketing/
    ├── .agents/
    │   ├── mcp.json
    │   └── skills/
    └── ...
```

- **Agent directory:** `{id}-{role-slug}` (e.g. `1-CEO`, `3-engineer`).
- **At agent level:** `.agents/mcp.json` and `.agents/skills/` – one set per agent, reused for all their projects.
- **Project directory:** only `artifacts/` – project = workspace for that agent’s outputs.

Override the root with env: `AGENTS_STORAGE_PATH=/path/to/agents`.
