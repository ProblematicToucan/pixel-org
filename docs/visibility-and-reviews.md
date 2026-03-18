# How agents work together: visibility and judgment

## How the CLI actually sees work (Engineer → CEO review)

1. **Engineer** does work in **project_1**: their CLI writes code/output to  
   `agents/{id}-engineer/project_1/artifacts/` (e.g. `agents/3-engineer/project_1/artifacts/`).

2. **Orchestrator** wants the **CEO** to review that work. It:
   - Resolves the CEO’s **agent dir** (e.g. `getAgentDir(ceoAgent)` → `/path/to/agents/1-ceo`). The CEO’s **MCP and skills** live there (`mcp.json`, `skills/`).
   - Calls **GET /agents/:ceoId/visible-work** (e.g. CEO id = 1).
   - Gets back a list of agents and **absolute** artifact paths the CEO can see, e.g.:
     ```json
     [
       { "agentId": 3, "name": "Engineer", "role": "Engineer", "agentDir": "/path/to/agents/3-engineer", "projects": [{ "projectId": "project_1", "artifactsPath": "/path/to/agents/3-engineer/project_1/artifacts" }] }
     ]
     ```
   - Runs the CEO via **agent-runner** with **`cwd` = CEO’s agent dir** (so the CLI loads MCP/skills from there) and **`visibleWork`** so the CEO can read the Engineer’s paths:
     ```ts
     runAgent({
       provider: "cursor",
       role: "CEO",
       task: "…",  // see example below
       cwd: getAgentDir(ceoAgent),   // e.g. /path/to/ceo – MCP/skills from here
       visibleWork: visibleWorkFromApi,
     });
     ```

3. **Agent-runner** runs the CLI with **`--workspace` = CEO’s dir** (so the CEO runs “in” `/path/to/ceo` and loads that agent’s MCP/skills). It sets env **`PIXEL_VISIBLE_WORK`** to the JSON of visible work (with **absolute** paths like `/path/to/engineer/project_1/artifacts`). Because the Engineer’s work is **outside** the CEO’s workspace, the runner adds **`--sandbox disabled`** when `visibleWork` is set, so the CEO process is allowed to **read those paths**. The CEO can then read the Engineer’s files when the task tells it to use the paths from `PIXEL_VISIBLE_WORK`.

4. **CEO’s task prompt** should tell the agent to:
   - Read **`PIXEL_VISIBLE_WORK`** from the environment (parse the JSON).
   - For each entry, for each `projectId` and `artifactsPath`, **read the files** in that directory (the Engineer’s code/artifacts).
   - Summarize and judge the work; optionally call **POST /reviews** to record approval/rejection and comments.

**Example task for CEO review run:**

```text
You are the CEO. Review your reports' work.

1. Read the environment variable PIXEL_VISIBLE_WORK (JSON). It lists agents and, for each, projects with an "artifactsPath". Each artifactsPath is a directory containing that agent's output for that project.

2. For each agent and project, read the files under artifactsPath and summarize what was done. Note quality, issues, and suggestions.

3. Optionally submit your judgment by calling the API: POST /reviews with body { "reviewerAgentId": <your agent id>, "subjectAgentId": <the report's agent id>, "projectId": "<project id>", "status": "approved" | "rejected" | "pending", "comment": "<your feedback>" }.
```

So: **Engineer writes to artifact paths → CEO (or any lead) is run with `visibleWork` → runner sets `PIXEL_VISIBLE_WORK` → CEO’s CLI reads that env and reads the files at each `artifactsPath` → CEO reviews and can POST /reviews.**

---

## Visibility (who can see whose work)

- The **reporting tree** is defined by `parent_id` on each agent (CEO has no parent; CTO’s parent is CEO; Engineer’s parent is CTO).
- **Visible work** = that agent **plus all their reports** (recursively). So:
  - **CEO** sees: CEO + CTO + Engineer + … (everyone).
  - **CTO** sees: CTO + Engineer + … (everyone under CTO).
  - **Engineer** sees: only themselves.

**API:** `GET /agents/:id/visible-work`  
Returns the list of agents and their `agentDir` and `projects[].artifactsPath` that this agent is allowed to see.

**Agent-runner:** When you call `runAgent({ ..., visibleWork })`, the runner sets **`PIXEL_VISIBLE_WORK`** to the JSON string of that array. The CLI must be instructed (in the task) to read this env and then read the files at each `artifactsPath`.

---

## Judgment (lead reviews report’s work)

- A **lead** (e.g. CTO or CEO) can **review** a report’s work: approve, reject, or leave pending, with an optional comment.
- Reviews are stored in the DB; the **subject** agent (e.g. Engineer) can read them to see feedback.

**API:**

- **POST /reviews** – Create a review (lead judging a report’s project).  
  Body: `{ reviewerAgentId, subjectAgentId, projectId, status?, comment? }`  
  `status`: `"pending"` | `"approved"` | `"rejected"` (default `"pending"`).
- **GET /agents/:id/reviews** – List reviews **received** by this agent (feedback on their work).

**Flow:** Lead’s CLI run reads report artifact paths from `PIXEL_VISIBLE_WORK`, reviews the code, then calls **POST /reviews**. The report (or a dashboard) uses **GET /agents/:id/reviews** to show that feedback.
