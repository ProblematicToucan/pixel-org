# Kickoff Lead Spawn Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Spawn the lead agent automatically with `model:auto` when the kickoff thread is created, with idempotent orchestration records and per-agent wake interval configuration for future scheduler work.

**Architecture:** Add a small orchestration layer in backend that records run requests and dispatches runner calls. Hook kickoff-thread creation into this layer. Extend the agent data model with per-agent awake interval fields without implementing the scheduler loop yet.

**Tech Stack:** Node.js, Express, Drizzle ORM, PostgreSQL migrations, TypeScript, existing `agent-runner` package.

---

### Task 1: Add orchestration persistence schema

**Files:**
- Modify: `packages/backend/src/db/schema.ts`
- Modify: `packages/backend/drizzle/0001_board_actor_messages.sql` (if this file is currently latest and used as baseline in repo)
- Create: `packages/backend/drizzle/0002_agent_run_requests.sql` (or next sequential migration)
- Test: `packages/backend` build/typecheck commands

**Step 1: Add run-request table to Drizzle schema**

Add a new table for orchestration:
- `id` (uuid)
- `projectId` (fk)
- `threadId` (fk)
- `agentId` (fk)
- `reason` (text)
- `model` (text; store `auto`)
- `idempotencyKey` (unique text)
- `status` (`queued|running|done|failed`)
- `error` (nullable text)
- timestamps (`createdAt`, `updatedAt`, `startedAt`, `finishedAt`)

**Step 2: Add per-agent wake fields in `agents` table**

Add:
- `awakeEnabled` boolean default true
- `awakeIntervalMinutes` integer/text-backed numeric default 30
- `lastAwakeAt` timestamp nullable
- `nextAwakeAt` timestamp nullable

**Step 3: Create SQL migration**

Run or author migration SQL that:
- Creates run-request table with unique index on `idempotency_key`.
- Adds wake fields to `agents`.

**Step 4: Verify backend compiles**

Run: `pnpm --filter @pixel-org/backend build`  
Expected: PASS

### Task 2: Implement orchestration service with idempotent kickoff dispatch

**Files:**
- Create: `packages/backend/src/services/orchestration.ts`
- Modify: `packages/backend/src/db/index.ts` (export new table if needed)
- Test: `packages/backend` build/typecheck

**Step 1: Create service API**

Add functions:
- `enqueueKickoffLeadRun({ projectId, threadId })`
- internal `findProjectLead(projectId)` (or global lead fallback if no project mapping exists)
- `createOrGetRunByIdempotencyKey(...)`

**Step 2: Add state transitions**

Implement helpers:
- set `queued` at insert
- transition to `running` before dispatch
- transition to `done` or `failed` with timestamps and error capture

**Step 3: Dispatch runner call**

Use existing `runAgent` integration path and pass:
- `agentId`
- `task` containing context including project/thread ids and kickoff reason
- `model` semantics set to `auto` (store in record and pass in env/task contract)

**Step 4: Verify backend compiles**

Run: `pnpm --filter @pixel-org/backend build`  
Expected: PASS

### Task 3: Hook kickoff thread creation to orchestration

**Files:**
- Modify: `packages/backend/src/index.ts`
- Modify: `packages/web/src/views/ProjectView.vue` (minimal adjustments only if needed)
- Test: backend + web build commands

**Step 1: Detect kickoff thread creation in backend**

In `POST /projects/:id/threads`:
- normalize title
- if title is `board kickoff`, call orchestration enqueue after insert

**Step 2: Keep endpoint responsive**

Do not block thread creation on long runner execution:
- kickoff enqueue should be fast
- return thread creation success even if background run later fails (failure is tracked in run-request status)

**Step 3: Preserve frontend behavior**

No breaking change required to current `ProjectView` flow; it still creates kickoff thread the same way.

**Step 4: Verify builds**

Run:
- `pnpm --filter @pixel-org/backend build`
- `pnpm --filter @pixel-org/web build`
Expected: PASS both

### Task 4: Add minimal observability endpoint for testing reactivity

**Files:**
- Modify: `packages/backend/src/index.ts`
- Test: backend build

**Step 1: Add endpoint**

Create:
- `GET /threads/:id/runs` returning run requests for that thread ordered newest-first.

**Step 2: Verify compile**

Run: `pnpm --filter @pixel-org/backend build`  
Expected: PASS

### Task 5: Add reactivity smoke test procedure (manual, documented)

**Files:**
- Modify: `docs/mcp-server-design.md` (append test procedure)
- Modify: `docs/plans/2026-03-20-kickoff-lead-spawn-design.md` (link to verification procedure)

**Step 1: Document procedure**

Document exact checks:
1. Save first project goals.
2. Confirm kickoff thread exists.
3. Call `GET /threads/:id/runs` and verify one run with `reason=kickoff_created`, `model=auto`.
4. Confirm agent posted a message referencing goals.
5. Re-trigger kickoff path and verify no duplicate run for same idempotency key.

**Step 2: Verify docs paths and consistency**

Run: `pnpm --filter @pixel-org/backend build`  
Expected: PASS (docs-only changes should not affect build)

### Task 6: Guardrails for future awake scheduler compatibility

**Files:**
- Modify: `packages/backend/src/index.ts` (`PATCH /agents/:id`)
- Modify: `packages/web/src/api.ts` (agent type fields)
- Optional Modify: `packages/web/src/views/*` only if exposing settings in UI now

**Step 1: Allow wake config updates**

Extend `PATCH /agents/:id` to accept:
- `awakeEnabled`
- `awakeIntervalMinutes` with floor validation (>= 3)

**Step 2: Keep UI/API backward compatible**

Expose fields in API types; no UI editor required in this slice unless requested.

**Step 3: Verify builds**

Run:
- `pnpm --filter @pixel-org/backend build`
- `pnpm --filter @pixel-org/web build`
Expected: PASS both

### Task 7: Final verification checklist

**Files:**
- No additional code files

**Step 1: Run lint diagnostics on touched files**

Use IDE diagnostics or project lint command for edited files.

**Step 2: Execute end-to-end smoke**

Create/update project goals to trigger kickoff and verify:
- thread created
- one run record created
- lead response present

**Step 3: Capture outcome**

Record pass/fail and any follow-up fixes needed for scheduler phase.
