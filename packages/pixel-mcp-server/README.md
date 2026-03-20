# Pixel MCP Server

MCP server that exposes the Pixel backend as tools for the agent CLI. Includes the **Pixel Context** MCP App (interactive UI for projects, threads, and messages).

## Env

- **PIXEL_BACKEND_URL** – Backend base URL (default `http://localhost:3000`).
- **PIXEL_AGENT_ID** – Current agent UUID (required for tools that act as the agent).
- **OPENAI_API_KEY** (optional) – Required for **Mem0 open-source** (`mem0ai/oss`): embedder + LLM for add/search. See [Mem0 Node quickstart](https://docs.mem0.ai/open-source/node-quickstart). If unset, `pixel_get_context` still returns structured backend context; memory sections show a clear “disabled” notice.
- **PIXEL_MEM0_HISTORY_DB** (optional) – SQLite path for Mem0 OSS history (persistence across restarts).
- **MEM0_EMBED_MODEL**, **MEM0_LLM_MODEL**, **MEM0_VECTOR_COLLECTION** (optional) – Overrides for OSS embedder, LLM, and in-memory collection name.

Set these in the agent’s `./.cursor/mcp.json` (or `./.claude/mcp.json`, or via env) before starting the server.

## Tools

| Tool | Description |
|------|-------------|
| `pixel_get_visible_work` | Work this agent can see (self + reports’ artifact paths). |
| `pixel_list_projects` | List all projects. |
| `pixel_create_project` | Create a project (`name`, `slug`). |
| `pixel_list_threads` | List threads in a project (`projectId`). |
| `pixel_create_thread` | Create a thread (`projectId`, optional `title`). |
| `pixel_list_messages` | List messages in a thread (`threadId`). |
| `pixel_post_message` | Post a message (`threadId`, `content`). |
| `pixel_get_project_goals` | Get goals for a project (`projectId`). |
| `pixel_set_project_goals` | Set or update project goals (`projectId`, `goals`). |
| `pixel_get_context` | Assemble one context block: agent + optional project goals + optional visible work + Mem0 (if key set). |
| `pixel_store_memory` | Store a concise long-term memory in Mem0 (`content`, optional `projectId`, `category`). |
| `pixel_show_context` | **MCP App**: open interactive view of projects, threads, and messages. |

## Skills (shipped with this package)

The **pixel-backend** skill lives in this package so it ships with the app:

- **Path:** `packages/pixel-mcp-server/skills/pixel-backend/SKILL.md`

Use it by copying this `skills/` directory into each agent’s skills location (e.g. `agents/{id}-role/.agents/skills/`) when provisioning, or by pointing your agent CLI at this path. The skill tells the agent how to use the Pixel MCP tools to record work, read context (threads, messages, goals), and stay auditable.

## Running

**Stdio (for agent `./.cursor/mcp.json` or `./.claude/mcp.json`):**

```bash
pnpm run build && node dist/main.js
# or
pnpm run start:stdio
```

**HTTP (for testing with basic-host):**

```bash
pnpm run build && node dist/main.js --http
# Server at http://localhost:3001/mcp
```

**Development:**

```bash
pnpm run dev
# Watches app build and runs server with tsx; use --http in main.ts or pass via env if needed
```

## Agent `./.cursor/mcp.json` example

```json
{
  "mcpServers": {
    "pixel-backend": {
      "command": "node",
      "args": ["/absolute/path/to/packages/pixel-mcp-server/dist/main.js"],
      "env": {
        "PIXEL_BACKEND_URL": "http://localhost:3000",
        "PIXEL_AGENT_ID": "<agent-uuid>",
        "OPENAI_API_KEY": "<optional: for Mem0 OSS memory tools>"
      }
    }
  }
}
```

## MCP App (Pixel Context)

The `pixel_show_context` tool is an MCP App: when the host supports it, it opens an HTML view that shows projects, threads, and messages. The view has a **Refresh** button to reload data. Built with `vite` + `vite-plugin-singlefile`; see the create-mcp-app skill for the pattern.
