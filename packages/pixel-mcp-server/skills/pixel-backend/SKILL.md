---
name: pixel-backend
description: Use Pixel MCP tools to record work, read context (projects, threads, messages, goals), and keep everything auditable. Use when running as an orchestrated agent that must sync with the Pixel backend, when starting or finishing a task, when checking user requests or tickets, or when reading or setting project goals.
---

# Pixel Backend (Agent ↔ Backend via MCP)

You interact with the Pixel backend **only through MCP tools** (no direct HTTP). The Pixel MCP server exposes tools so your work is recorded and the user can audit it, add requests via threads/messages, and set project goals.

## When to use

- **Before/during work:** Read projects, threads, messages (treat as user requests/tickets), and project goals.
- **When starting work:** Create or attach to a thread; post a "Started: …" message.
- **When finishing work:** Post "Completed: …" or "Blocked: …" to the thread.
- **If you are a lead:** Use `pixel_get_visible_work` to see reports' artifact paths and review their work.

## Tools (Pixel MCP)

| Tool | Purpose |
|------|--------|
| `pixel_list_projects` | List projects (channels). |
| `pixel_get_project_goals` | Get goals for a project (user-defined objectives). |
| `pixel_set_project_goals` | Set or update project goals. |
| `pixel_list_threads` | List threads in a project. |
| `pixel_create_thread` | Create a thread (e.g. start work on a task). Uses current agent as owner. |
| `pixel_list_messages` | List messages in a thread (tickets, comments). |
| `pixel_post_message` | Post a message (record progress, reply, feedback). |
| `pixel_get_visible_work` | (Leads) Get work you can see: self + all reports' artifact paths. |
| `pixel_show_context` | Open Pixel Context UI: projects, threads, messages (and goals) in one view. |

Identity (who you are) and backend URL are set via env (`PIXEL_AGENT_ID`, `PIXEL_BACKEND_URL`); you do not pass them in tool calls.

## Record and audit (minimum)

1. **At start of a task:**  
   - Ensure a thread exists for the project and your work (create one with `pixel_create_thread` if needed).  
   - Post a message: e.g. "Started: [short task description]".

2. **At end of task:**  
   - Post a message: "Completed: [summary]" or "Blocked: [reason]".

This keeps every run tied to a thread and messages so the user can audit what was done.

## Read user input (tickets, comments, goals)

- **Messages in a thread** = user requests, tickets, or comments. List threads for the project, then list messages for each thread; treat new or relevant messages as work to do or feedback to address.
- **Project goals** = user-defined objectives. Call `pixel_get_project_goals` for the project you're working on and align your work with those goals. If the user sets goals via the app, use `pixel_set_project_goals` only when explicitly asked to update them.

## Autonomous runs (e.g. while user is away)

When run autonomously (e.g. scheduled):

1. Call `pixel_list_projects` (and optionally `pixel_get_project_goals` for each).
2. For your project(s), call `pixel_list_threads` and `pixel_list_messages` to see new requests or comments.
3. Create a thread or use an existing one; post "Started: …", do the work, then post "Completed: …" or "Blocked: …".

Same tools; no direct API calls. Everything stays recorded and auditable.
