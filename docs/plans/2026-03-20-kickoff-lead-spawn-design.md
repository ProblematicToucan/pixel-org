# Kickoff Lead Spawn Design

**Date:** 2026-03-20

**Context**
- Board goals are authored in the project page.
- First non-empty goals save creates a `Board kickoff` thread.
- We need the lead agent to spawn immediately on kickoff creation using model `auto`.
- Future direction includes thread assignment and periodic awake cycles.

## Scope

### In Scope (now)
- Trigger lead spawn when kickoff thread is created.
- Use `model: auto` for kickoff-triggered runs.
- Add idempotency so kickoff does not spawn duplicate lead runs.
- Add run status persistence for observability (`queued|running|done|failed`).
- Define a per-agent wake interval configuration model for future scheduler.

### Out of Scope (now)
- Full scheduler daemon implementation.
- Full thread assignment UX.
- Multi-agent collaboration automation policies.

## Trigger and Spawn Contract

### Trigger
- Event: creation of canonical kickoff thread (`Board kickoff`).
- Current compatibility: title-based detection; forward-compatible with dedicated thread type field.

### Spawn action
- Target: lead agent for the project.
- Run payload:
  - `agentId`
  - `threadId`
  - `reason: kickoff_created`
  - `model: auto`

### Idempotency
- Key format: `kickoff_spawn:{projectId}:{threadId}:{leadAgentId}`.
- Duplicate requests with same key are no-op and return prior run record.

## Persistence and Observability

- Add a run request record to track:
  - trigger reason
  - idempotency key
  - requested model
  - status lifecycle (`queued|running|done|failed`)
  - timestamps and optional error
- This record is reused later by awake-cycle triggers to keep one orchestration model.

## Future-Compatible Assignment and Awake Model

### Thread assignment model
- Thread fields (future): `assignedAgentId`, `assignedByActorType`, `assignedAt`, `assignmentStatus`.
- Kickoff default assignment: lead.

### Per-agent wake config
- Agent-level configuration:
  - `awakeEnabled: boolean`
  - `awakeIntervalMinutes: number`
  - optional `awakeJitterSeconds: number`
  - `lastAwakeAt`, `nextAwakeAt`
- Each agent has independent cadence (e.g. lead every 5 min, specialist every 30 min).

### Scheduler behavior (future)
- Select due agents where `awakeEnabled=true` and `nextAwakeAt <= now`.
- Trigger run with `reason: scheduled_awake`, `model: auto`.
- Enforce one active run lock per agent.
- Apply failure backoff and interval floor.

## Reactivity Test Protocol

1. Board saves first non-empty goals.
2. System creates kickoff thread.
3. System enqueues exactly one lead run with `model:auto`.
4. Lead posts response referencing project goals.
5. Repeated kickoff-trigger attempts do not create duplicate runs.

## Design Decisions

- Keep kickoff trigger server-side for reliability.
- Keep `model:auto` on all orchestrated runs unless explicitly overridden later.
- Use per-agent interval config now in data model so future scheduler is additive, not migratory.
