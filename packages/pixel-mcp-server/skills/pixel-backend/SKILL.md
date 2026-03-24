---
name: pixel-backend
description: Use Pixel MCP tools to record work, read context (projects, threads, messages, goals), and keep everything auditable. Use when running as an orchestrated agent that must sync with the Pixel backend, when starting or finishing a task, when checking user requests or tickets, or when reading or setting project goals.
---

# Pixel Backend (Agent ↔ Backend via MCP)

You interact with the Pixel backend **only through MCP tools** (no direct HTTP). The Pixel MCP server exposes tools so your work is recorded and the user can audit it, add requests via threads/messages, and set project goals.

## When to use

- **At the start of important work:** Call `pixel_get_context` (optionally with `projectId`) so you load structured facts plus long-term semantic memory — stay aligned with the main simulation goals.
- **After a meaningful decision or insight:** Call `pixel_store_memory` with one short sentence or bullet (not the whole chat).
- **Before/during work:** Read projects, threads, messages (treat as user requests/tickets), and project goals.
- **When starting work:** Create or attach to a thread (`pixel_create_thread`; use `ownerAgentId` to assign a report if you are a lead); post via `pixel_post_message` with structured `status: "started"` plus objective/content.
- **When finishing work:** Post via `pixel_post_message` with structured `status: "completed"` and a clear objective/reason. Run-level status is only `started` | `in_progress` | `completed`. If the **work item** is blocked, set the thread to `blocked` with `pixel_set_thread_status` and explain blockers in the message `reason` / content (do not invent a fourth run status).
- **If you are a lead:** Use `pixel_get_visible_work` to see reports' per-project workspace paths and review their work.
- **Before hiring or when you need the org chart:** Call `pixel_list_agents` so you know who already exists (avoids blind duplicate hires).

## Tools (Pixel MCP)

| Tool | Purpose |
|------|--------|
| `pixel_list_agents` | List all agents in the organization (`id`, `name`, `role`, lead flag, `parent_id`, etc.). Use before `pixel_hire_agent` to see current members. |
| `pixel_list_projects` | List projects (channels). |
| `pixel_get_project_goals` | Get goals for a project (user-defined objectives). |
| `pixel_set_project_goals` | Set or update project goals. |
| `pixel_list_threads` | List threads in a project. Optional `status` filter: not_started, in_progress, completed, blocked, cancelled. |
| `pixel_create_thread` | Create a thread (e.g. start work on a task). Default owner = current agent. Optional `ownerAgentId` assigns another agent (self, or as a lead: a report in your line). Optional `status` sets initial status (default: not_started). |
| `pixel_set_thread_status` | Set thread status (not_started, in_progress, completed, blocked, cancelled). Only thread owner or Board of Directors can change status. Posts informational message on change. |
| `pixel_list_messages` | List messages in a thread (tickets, comments). |
| `pixel_post_message` | Post a message (record progress, reply, feedback). |
| `pixel_create_approval_request` | (Thread owner) Request approval from your **direct manager** (`parent_id`). Thread must be `in_progress`; enqueues the approver to run. |
| `pixel_list_approval_requests` | List approvals **as approver** (inbox) or **as requester**; optional `status` (e.g. `pending`). |
| `pixel_resolve_approval_request` | (Assigned approver only) Approve or reject; posts audit line on source thread and notifies requester. |
| `pixel_cancel_approval_request` | (Requester) Cancel a pending approval. Omit from the server by setting **`PIXEL_ENABLE_CANCEL_APPROVAL=false`** on the MCP process. |
| `pixel_get_visible_work` | (Leads) Get work you can see: self + all reports' per-project workspace paths. |
| `pixel_hire_agent` | (Leads) Hire/create a new child agent under yourself (`name`, `role`, optional `config`, optional full `agentsMd`, optional **`idempotencyKey`**). Reusing the same key for the same hire intent returns the existing agent (safe retries; no duplicate row). |
| `pixel_get_context` | **Start of task:** one block with agent info, optional project goals, optional visible-work paths, and **Mem0 OSS** semantic memory (if `OPENAI_API_KEY` is set). Keeps long-term goals and facts. |
| `pixel_store_memory` | Store a **concise** long-term memory in Mem0 (decision, insight, preference, fact). Scoped by agent and optional `projectId`. Do not paste full transcripts. |
| `pixel_show_context` | Open Pixel Context UI: projects, threads, messages (and goals) in one view. |

Identity (who you are) and backend URL are set via env (`PIXEL_AGENT_ID`, `PIXEL_BACKEND_URL`); you do not pass them in tool calls. Optional **`OPENAI_API_KEY`** on the MCP server enables Mem0 open-source semantic memory (`pixel_get_context`, `pixel_store_memory`). See [Mem0 Node quickstart](https://docs.mem0.ai/open-source/node-quickstart).

**Filesystem (orchestrated runs):** The Cursor process may also set **`PIXEL_PROJECT_WORKSPACE`** and **`PIXEL_PROJECT_ARTIFACTS`** to the on-disk project folder and its `artifacts/` subdir. Your CLI workspace is that project folder (with `AGENTS.md` / MCP / skills mirrored from the agent home). Keep local work and clones there unless a tool requires reading elsewhere.

## Orchestration and thread status

The backend **only auto-runs** agents (kickoff, new message on a thread, scheduled awake) when the thread’s **work-item status** is **`in_progress`**. If status is `not_started`, `completed`, `blocked`, or `cancelled`, those triggers are skipped (no agent CLI spawn). Set the thread to **`in_progress`** (Board or owner via `pixel_set_thread_status`) when work should actively run.

## Record and audit (minimum)

1. **At start of a task:**  
   - Ensure a thread exists for the project and your work (create one with `pixel_create_thread` if needed).  
   - Post via `pixel_post_message` with `status: "started"` and a short objective.
   - Do this immediately; do not wait until code changes are complete.

2. **At end of task:**  
   - Post via `pixel_post_message` with `status: "completed"` and summary in objective/reason/content. If the thread work item cannot proceed, call `pixel_set_thread_status` with `blocked` and document why in the message.

Hard requirement:
- Every autonomous run must produce at least one `pixel_post_message` update in the assigned thread.
- If execution fails, still post a `pixel_post_message` with `status: "completed"` and the concrete failure in `reason` / content; set thread status as appropriate.

This keeps every run tied to a thread and messages so the user can audit what was done.

## Read user input (tickets, comments, goals)

- **Threads** = work items (like GitHub issues). Each thread has a status: `not_started`, `in_progress`, `completed`, `blocked`, or `cancelled`. Use `pixel_list_threads` with `status` filter to find work that needs attention (e.g., `status: "not_started"` or `status: "in_progress"`).
- **Messages in a thread** = user requests, tickets, or comments. List threads for the project, then list messages for each thread; treat new or relevant messages as work to do or feedback to address.
- **Project goals** = user-defined objectives. Call `pixel_get_project_goals` for the project you're working on and align your work with those goals. If the user sets goals via the app, use `pixel_set_project_goals` only when explicitly asked to update them.
- **Thread status** = overall state of a work item. When you finish all work in a thread, set status to `completed` using `pixel_set_thread_status`. If blocked, set to `blocked`. Status changes post informational messages so agents know when threads are reopened or updated.

## Autonomous runs (e.g. while user is away)

When run autonomously (e.g. scheduled):

1. Call `pixel_list_projects` (and optionally `pixel_get_project_goals` for each).
2. For your project(s), call `pixel_list_threads` with `status: "not_started"` or `status: "in_progress"` to find work that needs attention.
3. For each relevant thread, call `pixel_list_messages` to see new requests or comments.
4. Create a thread or use an existing one; post `status: "started"`, do the work, then post `status: "completed"` (and use `pixel_set_thread_status` for blocked work items).
5. When all work in a thread is done, set thread status to `completed` using `pixel_set_thread_status`.

Same tools; no direct API calls. Everything stays recorded and auditable.

## Lead hiring policy

- Only one lead exists per organization; new hires are always non-lead reports (the MCP tool does not offer a “hire as lead” option).
- **See who works here first:** call `pixel_list_agents` so you do not hire duplicates with the same name/role by mistake.
- If you are a lead and need more execution capacity, use `pixel_hire_agent` directly.
- **Retries / double calls:** pass a stable **`idempotencyKey`** (e.g. a UUID you generate once per hire intent). The backend stores it on the new row; the same key under the same hiring parent returns the **existing** agent (`idempotentReplay` in the response) instead of creating another row.
- Hiring should happen through lead agents, not by asking the user to manually create agents.
- If you need custom persona instructions, pass `agentsMd` to write the hired agent's full `AGENTS.md`.
- After hiring, delegate via threads/messages and review outputs with `pixel_get_visible_work`.
