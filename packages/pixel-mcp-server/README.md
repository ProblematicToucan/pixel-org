# Pixel MCP Server

MCP server that exposes the Pixel backend as tools for the agent CLI. Includes the **Pixel Context** MCP App (interactive UI for projects, threads, and messages).

## Env

- **PIXEL_BACKEND_URL** – Backend base URL (default `http://localhost:3000`).
- **PIXEL_AGENT_ID** – Current agent UUID (required for tools that act as the agent).

Set these in the agent’s `mcp.json` or before starting the server.

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
| `pixel_show_context` | **MCP App**: open interactive view of projects, threads, and messages. |

## Running

**Stdio (for agent `mcp.json`):**

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

## Agent `mcp.json` example

```json
{
  "mcp": [
    {
      "name": "pixel-backend",
      "command": "node",
      "args": ["/absolute/path/to/packages/pixel-mcp-server/dist/main.js"],
      "env": {
        "PIXEL_BACKEND_URL": "http://localhost:3000",
        "PIXEL_AGENT_ID": "<agent-uuid>"
      }
    }
  ]
}
```

## MCP App (Pixel Context)

The `pixel_show_context` tool is an MCP App: when the host supports it, it opens an HTML view that shows projects, threads, and messages. The view has a **Refresh** button to reload data. Built with `vite` + `vite-plugin-singlefile`; see [create-mcp-app](.agents/skills/create-mcp-app/SKILL.md) for the pattern.
