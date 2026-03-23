# MCP Server Design: Agent ↔ Backend via MCP (not REST API)

**Goal:** Have the agent CLI (Cursor/Claude Code) interact with the Pixel backend through **MCP tools** instead of calling a REST API. Everything stays recorded and auditable; user can add requests via threads/messages and project goals.

**Context (from agent transcripts):**
- Backend: agents, projects, threads, messages; visible-work; UUIDs.
- Agent CLI runs with `--workspace` = **per-project dir** under the agent (`…/{agent}/{project-id}/`). Canonical `AGENTS.md`, MCP config, and `.agents` live in the **agent home**; the backend **symlinks** them into that project folder so MCP/skills and shell cwd align with the Pixel project path.
- We want a single, consistent way for each agent to: record work, read context (tickets/comments, goals), and get visible work — without teaching the agent “call this HTTP endpoint” in a skill.

---

## 1. Why MCP instead of API?

| Aspect | REST API + skill | MCP server |
|--------|-------------------|------------|
| **Agent experience** | Agent must read a skill that says “call GET /threads/… with PIXEL_BACKEND_URL”. Easy to get wrong (URL, body, auth). | Agent sees **tools** (e.g. `pixel_list_my_threads`, `pixel_post_message`). Same pattern as other MCP tools (Notion, browser). |
| **Discovery** | Skill text + env vars. | Tools listed by MCP; schema (args, types) is explicit. |
| **Auditability** | All calls go to backend; we can log. | All calls still go to backend (MCP server calls backend); we can log in backend or in MCP server. |
| **Cursor/Claude integration** | No first-class integration; agent “decides” to HTTP. | MCP is first-class: one entry in `./.cursor/mcp.json` or `./.claude/mcp.json`; agent uses tools like any other MCP. |

So: **MCP gives a cleaner contract (tools + schema) and better integration with the CLI**, while we keep the same backend and same audit trail.

---

## 2. Do we need a separate module?

**Yes. Use a separate package: `packages/pixel-mcp-server` (or `mcp-server`).**

Reasons:

1. **Single responsibility**  
   - Backend = REST API + DB + visibility/reviews logic.  
   - MCP server = “expose backend capabilities as MCP tools for the agent.”  
   Keeping them separate avoids mixing HTTP API with MCP protocol in one process.

2. **Deployment flexibility**  
- MCP server is typically run as a **stdio** process **spawned by the IDE/CLI** (see agent’s `./.cursor/mcp.json` or `./.claude/mcp.json`).
   - That process only needs: env (agent id, backend URL) and network access to the backend.  
   - Backend can stay “just REST”; no need to run MCP inside the same Node process.

3. **Reuse and testing**  
   - One package that “talks MCP on stdio, calls backend over HTTP.”  
   - Easy to test: mock backend HTTP; assert tool calls and responses.  
   - Backend stays unaware of MCP.

4. **Consistency with agent-runner**  
   - You already have a separate `packages/agent-runner` for “how we run the CLI.”  
   - `packages/pixel-mcp-server` is “how the CLI talks to our backend” — same idea.

**Suggested repo layout:**

```
packages/
  backend/           # REST API, DB, visible-work, projects, threads, messages
  agent-runner/      # Spawn agent CLI with role, visibleWork, env
  pixel-mcp-server/  # MCP server (stdio) → tools that call backend HTTP
```

---

## 3. Transport: stdio vs HTTP

- **stdio**  
- Cursor/Claude CLI spawn the MCP server from `./.cursor/mcp.json` or `./.claude/mcp.json` (e.g. `node path/to/pixel-mcp-server.js`).
- Env can be set in those per-agent MCP files or by the orchestrator before starting the agent.
  - One process per “agent session”; no extra port.  
  **Recommendation: use stdio** so each agent run gets its own MCP server process with that agent’s identity (env).

- **HTTP/SSE**  
- Backend (or a separate service) would expose an MCP endpoint; `./.cursor/mcp.json` / `./.claude/mcp.json` would point to a URL.
  - You’d need to pass “which agent is calling” on each request (header/token).  
  - Possible later if you want a single long-lived MCP service; for “agent talks to our backend,” stdio is simpler.

So: **implement the MCP server as a stdio server in `packages/pixel-mcp-server`.**

---

## 4. Agent identity and backend URL

- **PIXEL_AGENT_ID**  
  - Set by orchestrator (or in agent config) when the agent is run.  
  - The MCP server reads this from env and sends it on every backend call that needs “current agent” (e.g. create thread, post message, get visible work).

- **PIXEL_BACKEND_URL**  
  - Base URL of the backend (e.g. `http://localhost:3000`).  
  - MCP server uses this to call REST endpoints.  
  - Can be set in env or in a small config file next to the server.

No auth in v1: assume backend and MCP server run in a trusted environment (e.g. same machine or internal network). Later you can add an API key or JWT and send it in a header from the MCP server to the backend.

---

## 5. Tool list (mapping from current API)

Backend already has:

- `GET /agents/:id/visible-work`
- `GET /projects`, `POST /projects`
- `GET /projects/:id/threads`, `POST /projects/:id/threads`
- `GET /threads/:id/messages`, `POST /threads/:id/messages`

Expose these as MCP tools so the agent doesn’t need to know HTTP or URLs. Suggested names and behavior:

| MCP tool | Backend call | Purpose |
|----------|----------------|---------|
| `pixel_get_visible_work` | GET /agents/:id/visible-work | Lead sees self + reports’ per-project workspace paths (`projectPath`; and can read those dirs). |
| `pixel_list_projects` | GET /projects | List projects (channels). |
| `pixel_create_project` | POST /projects | Create project (if we allow agent to). Optional. |
| `pixel_list_threads` | GET /projects/:id/threads | List threads in a project. |
| `pixel_create_thread` | POST /projects/:id/threads | Create a thread (e.g. “start work on X”); body: agentId (use PIXEL_AGENT_ID), optional title. |
| `pixel_list_messages` | GET /threads/:id/messages | List messages in a thread (tickets/comments). |
| `pixel_post_message` | POST /threads/:id/messages | Post a message (body: agentId = PIXEL_AGENT_ID, content). |

All tools that need “current agent” take it from env (`PIXEL_AGENT_ID`); the server injects it so the agent doesn’t pass agent id in every tool call (optional: allow override for “post as X” if needed later).

**Project goals (Option B):**

- Backend: `projects.goals` (TEXT), `GET /projects/:id`, `PATCH /projects/:id` (body: `goals`).
- MCP tools: `pixel_get_project_goals` (projectId), `pixel_set_project_goals` (projectId, goals). List projects already returns goals.

Optional (later):

- **Resources** (read-only): e.g. `pixel://agent/visible-work` so the agent can pull visible work as a resource instead of/in addition to a tool.

### Semantic memory (Mem0 open-source)

Threads and messages remain the **audit trail**; [Mem0 OSS](https://docs.mem0.ai/open-source/node-quickstart) (`mem0ai/oss`) holds **compressed long-term recall** (decisions, preferences, main ideas) in-process (in-memory vector store + optional SQLite history).

| MCP tool | Behavior |
|----------|----------|
| `pixel_get_context` | Merges structured data from the backend (current agent row, optional project goals, optional visible-work JSON) with OSS `Memory.search` for the scoped `userId`. If **`OPENAI_API_KEY`** is missing, structured sections still work; Mem0 is skipped with a short notice. |
| `pixel_store_memory` | Adds a concise memory via OSS `Memory.add` with `infer: false`, scoped by **`pixel:{agentId}:global`** or **`pixel:{agentId}:p:{projectId}`**. |

Env: **`OPENAI_API_KEY`** on the MCP server (embedder + LLM). Optional: **`PIXEL_MEM0_HISTORY_DB`** for SQLite history path; **`MEM0_EMBED_MODEL`**, **`MEM0_LLM_MODEL`**, **`MEM0_VECTOR_COLLECTION`** overrides.

---

## 6. How the agent uses it (no “call API” skill)

1. **mcp.json (per agent)**  
   Add an entry that runs the Pixel MCP server, with env pointing to backend and agent id.  
   Example (conceptual):

   ```json
  {
    "mcpServers": {
      "pixel-backend": {
         "command": "node",
         "args": ["/absolute/path/to/packages/pixel-mcp-server/dist/index.js"],
         "env": {
           "PIXEL_BACKEND_URL": "http://localhost:3000",
           "PIXEL_AGENT_ID": "<filled by orchestrator or script>"
         }
       }
    }
   }
   ```

   The orchestrator (or a script that creates the agent dir) can write `PIXEL_AGENT_ID` into this file when provisioning the agent.

2. **Agent behavior**  
   - At start: call `pixel_list_projects`, then for “my” project(s) call `pixel_list_threads` and `pixel_list_messages` → treat messages as tickets/comments/requests.  
   - When starting work: `pixel_create_thread` (or reuse existing thread) and `pixel_post_message` (“Started: …”).  
   - When finishing: `pixel_post_message` (“Completed: …” or “Blocked: …”).  
   - If lead: `pixel_get_visible_work` to get report per-project paths, then read those dirs (sandbox disabled when needed).  

   So the **minimum skills** for “record and audit” and “read user input” become: “Use the Pixel MCP tools (pixel_*) to list projects/threads/messages, create threads, and post messages.” No HTTP or URLs in the skill.

3. **Orchestrator**  
   - Still uses **backend REST API** for its own logic (e.g. GET /agents/:id/visible-work before calling `runAgent({ visibleWork })`).  
   - Still uses **agent-runner** to spawn the CLI with role, task, cwd, visibleWork.  
   - Only the **agent process** talks to the backend via MCP (through the Pixel MCP server).

---

## 7. Implementation outline

1. **Add package `packages/pixel-mcp-server`**
   - Deps: `@modelcontextprotocol/sdk`, `zod`, and an HTTP client (e.g. `node-fetch` or built-in fetch).
   - No dependency on `backend` package; only on “backend base URL” and env.

2. **Implement stdio MCP server**
   - Read `PIXEL_AGENT_ID`, `PIXEL_BACKEND_URL` from env.
   - Register tools: `pixel_get_visible_work`, `pixel_list_projects`, `pixel_list_threads`, `pixel_create_thread`, `pixel_list_messages`, `pixel_post_message` (and optionally `pixel_create_project`).
   - Each tool handler: HTTP request to backend, return result (or error) as MCP tool result.

3. **Backend**
   - No change for v1. Optional: add logging or a middleware that logs “request from MCP” (e.g. User-Agent or header) for audit.

4. **Agent provisioning**
   - When creating an agent (DB + `ensureAgentDir`), write or update `./.cursor/mcp.json` (or `./.claude/mcp.json`) in the **agent home** with the Pixel MCP server entry and `PIXEL_AGENT_ID` (and optionally `PIXEL_BACKEND_URL` if not global). Orchestrated runs symlink those files into each **project** workspace dir for the CLI.

5. **Docs**
   - Update `docs/visibility-and-reviews.md` (or a new doc) to say: “Agents interact with the backend via the Pixel MCP server (tools), not by calling the REST API directly.”
   - Document the tool list and that `PIXEL_AGENT_ID` / `PIXEL_BACKEND_URL` must be set (by orchestrator or mcp.json).

6. **Skills**
   - Replace (or simplify) the “pixel-backend” skill to: “Use the Pixel MCP tools to record work (create thread, post start/complete messages) and to read context (list projects, threads, messages). Treat messages as user requests/tickets.”

---

## 8. Summary

| Question | Answer |
|----------|--------|
| **Separate module?** | **Yes:** `packages/pixel-mcp-server`. |
| **Transport?** | **stdio** (spawned from agent’s mcp.json). |
| **Identity?** | Env: `PIXEL_AGENT_ID`, `PIXEL_BACKEND_URL`. |
| **Backend changes?** | None for v1; MCP server calls existing REST API. |
| **Agent skills?** | “Use Pixel MCP tools to record and read context”; no HTTP in the skill. |

This keeps the backend as the single source of truth and audit log, while the agent gets a first-class, tool-based way to interact with it via MCP.
