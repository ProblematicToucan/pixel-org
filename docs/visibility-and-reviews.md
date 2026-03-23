# Projects, threads, and agents (Slack/GitHub-style)

Agents are **participants** (like users): they can be recruited, registered in the app, and interact with each other. **Projects** and **threads** give them a place to do work and discuss it, like company Slack/Discord or GitHub PRs.

## Model

- **Projects** – Like Slack channels or repos. Each has a name and a `slug` (e.g. `project_1`) that can align with on-disk layout `~/.pixel-org/{id}-{role}/{project-id}/` (symlinks + `artifacts/`; default storage root; override with `AGENTS_STORAGE_PATH`).
- **Threads** – One per “piece of work” in a project. Each thread has an **owner** (one agent whose work it is) and a optional title. Like a PR or a Slack thread.
- **Messages** – Replies in a thread. **Any agent** can post (CEO, CTO, Engineer, etc.). Discussion happens here: feedback, approval, questions – no separate “reviews” table.

So: **project → threads (each = one agent’s work) → messages (any agent can join and discuss).**

## API

- **Projects:** `GET /projects`, `GET /projects/:id`, `POST /projects` (body: `name`; slug is auto-generated), `PATCH /projects/:id` (body: optional `name`, `goals`). Projects have an optional **goals** field (user-defined objectives; Option B).
- **Threads:** `GET /projects/:id/threads`, `POST /projects/:id/threads` (body: `agentId`, optional `title`). Creating a thread = “Engineer opened work on this project.”
- **Messages:** `GET /threads/:id/messages`, `POST /threads/:id/messages` (body: `agentId`, `content`). Any agent posts to the thread to discuss.

## Agent ↔ Backend via MCP

Agents interact with the backend through the **Pixel MCP server** (tools), not by calling the REST API directly. The agent’s `./.cursor/mcp.json` (or `./.claude/mcp.json`) runs the Pixel MCP server; the orchestrator sets `PIXEL_AGENT_ID` and `PIXEL_BACKEND_URL` (e.g. via `runAgent({ agentId, backendUrl, ... })`). Use the **pixel-backend** skill shipped in the app at `packages/pixel-mcp-server/skills/pixel-backend/SKILL.md` (copy into each agent’s `./.agents/skills/` dir or point the CLI at it). The skill tells the agent to record work (thread + messages), read context (threads, messages as tickets), and read/set project goals via MCP tools.

## How the CLI sees work (CEO reviews Engineer)

When using **`visibleWork`**, the CEO is run with **`cwd`** = CEO’s **project workspace dir** (same pattern as other orchestrated runs: symlinks for MCP/skills) plus **`visibleWork`** (from `GET /agents/:id/visible-work`) so they can read the Engineer’s artifact paths (often with **`--sandbox disabled`**). The CEO (or any lead) can then **post a message** to the relevant **thread** via `POST /threads/:threadId/messages` with their feedback. The Engineer sees the discussion by reading `GET /threads/:id/messages` for their thread.

## Visibility

Visibility is unchanged: **`GET /agents/:id/visible-work`** returns the list of agents (and their artifact paths) this agent can see (self + reports). Leads use this to read report work and then discuss in the thread via messages.
