# Pixel Org – Company Simulation & Agent Roles

This repo simulates **how a company works**: users define **org structures** and **roles** (any names: e.g. CEO, Tech Lead, Designer, QA). The hierarchy (who reports to whom) and which roles can **recruit** new agents are configured in the backend, not hardcoded. When the orchestrator runs an agent CLI, it passes the **role slug** so the agent knows its place in the org.

## How it works

- **Org structure** – User-defined (e.g. “My company”, “Startup”). Stored in the backend.
- **Roles** – User-defined name + slug per structure (e.g. name “CEO” / slug `ceo`, or “Tech Lead” / `tech_lead`). Each role has an optional parent (who they report to) and optional **can_recruit**: if true, that role can create new agents (recruit employees) for the org.
- **Agents** – Instances assigned to a role and optionally to a parent agent. Lead agents (roles with can_recruit) can recruit new agents to do tasks.
- **When you run** – The orchestrator sets `PIXEL_AGENT_ROLE` to the role slug for this run. Your behavior should match that role’s **allowed_actions** (if provided) and the task context. There is no fixed list of role names; they come from the org definition.

## Role behavior (generic)

- **Role name and slug** – Defined in the backend per org structure. You receive the **slug** (e.g. `tech_lead`, `designer`). Act according to the responsibility implied by the task and any **allowed_actions** for that role (read, write, delete, approve, etc.).
- **Lead roles** – Roles with **can_recruit** can request creation of new agents (recruit). When your role has this permission and the task involves adding capacity, you may ask the orchestrator to create a new agent with a given role and task assignment. The orchestrator enforces who can recruit.
- **Default** – If no role is set, perform the requested task with minimal necessary permissions (read/write/delete only as needed), within the scope given.

## For CLI invocation

The **agent-runner** sets `PIXEL_AGENT_ROLE` to the role slug for the run. The slug is user-defined (from `org_roles`). Use it to align your actions with that role’s purpose and allowed actions; there is no fixed schema of role names like CEO or CTO.
