# Lead Governance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enforce role-boundary governance at the backend API level so lead agents cannot act as superman. Leads coordinate, delegate, and review — they do not execute operational work directly.

**Architecture:** Central policy evaluator module called by every mutating endpoint before DB writes. Reuses existing hierarchy tree from `visible-work.ts`. Migration adds `task_type` to threads.

**Tech Stack:** Node.js, Express, Drizzle ORM, PostgreSQL migrations, TypeScript, `node:test` for unit tests.

---

### Task 1: Add `taskType` field to threads schema + migration

**Files:**
- Modify: `packages/backend/src/db/schema.ts`
- Create: `packages/backend/drizzle/XXXX_governance_task_type.sql` (next sequential migration number)
- Test: `pnpm --filter @pixel-org/backend build`

**Step 1: Add column to Drizzle schema**

In `threads` table definition, add:
```ts
taskType: text("task_type")
  .notNull()
  .default("general")
  .$type<"technical" | "operations" | "finance" | "strategy" | "general">(),
```

Place it after the `status` column for logical grouping.

**Step 2: Create SQL migration**

Add migration file with:
```sql
ALTER TABLE "threads" ADD COLUMN "task_type" text NOT NULL DEFAULT 'general';
```

**Step 3: Verify build**

Run: `pnpm --filter @pixel-org/backend build`
Expected: PASS

---

### Task 2: Add actor-relation resolver to `visible-work.ts`

**Files:**
- Modify: `packages/backend/src/services/visible-work.ts`
- Test: `pnpm --filter @pixel-org/backend build`

**Step 1: Add relation type and resolver**

Export a new type and function:

```ts
export type ActorRelation = "self" | "descendant" | "ancestor" | "unrelated";

export async function resolveActorRelation(
  db: Db,
  actorId: string,
  targetId: string
): Promise<ActorRelation>
```

Logic:
1. If `actorId === targetId` → `"self"`
2. Get descendants of actor; if target is in descendants → `"descendant"`
3. Get descendants of target; if actor is in target's descendants → `"ancestor"`
4. Otherwise → `"unrelated"`

Reuses existing `getDescendantAgents`.

**Step 2: Verify build**

Run: `pnpm --filter @pixel-org/backend build`
Expected: PASS

---

### Task 3: Create governance policy module

**Files:**
- Create: `packages/backend/src/services/governance-policy.ts`
- Test: `pnpm --filter @pixel-org/backend build`

**Step 1: Define policy result types**

```ts
export type PolicyDecision =
  | { allowed: true }
  | { allowed: false; code: "denied" | "must_delegate" | "requires_approval"; reason: string };
```

**Step 2: Implement `evaluateThreadCreation`**

```ts
export async function evaluateThreadCreation(db: Db, params: {
  requesterAgentId: string;
  ownerAgentId: string;
  taskType: string;
  title: string | null;
}): Promise<PolicyDecision>
```

Rules:
- If requester `isLead` and owner is self and taskType is NOT `"strategy"` and title is NOT `"Board kickoff"` (normalized) → `{ allowed: false, code: "must_delegate", reason: "Lead agents must delegate operational threads to reports" }`
- Otherwise delegate to existing `canAssignThreadOwner` logic for hierarchy check.

**Step 3: Implement `evaluateMessagePosting`**

```ts
export async function evaluateMessagePosting(db: Db, params: {
  actorAgentId: string;
  actorType: "agent" | "board";
  threadId: string;
  runStatus: string | null;
}): Promise<PolicyDecision>
```

Rules:
- Board actor → always allowed.
- Actor is thread owner → always allowed.
- Actor is in owner's ancestor chain (manager) → allowed IF no `runStatus` (review messages only). If `runStatus` is set → denied ("Managers may review but not post execution status updates on report threads").
- Actor is descendant of owner → denied ("Reports cannot post on peer/manager threads").
- Actor is unrelated → denied.

**Step 4: Implement `evaluateThreadStatusChange`**

```ts
export async function evaluateThreadStatusChange(db: Db, params: {
  requesterAgentId: string;
  actorType: "agent" | "board";
  threadId: string;
  newStatus: string;
}): Promise<PolicyDecision>
```

Rules:
- Board → always allowed.
- Thread owner → allowed for any status.
- Owner's ancestor (manager) → allowed for `blocked` and `cancelled` only (management override).
- Otherwise → denied.

**Step 5: Verify build**

Run: `pnpm --filter @pixel-org/backend build`
Expected: PASS

---

### Task 4: Write governance policy tests

**Files:**
- Create: `packages/backend/src/services/governance-policy.test.ts`
- Test: `node --test packages/backend/src/services/governance-policy.test.ts`

Follow existing test pattern from `orchestration-contract.test.ts` (uses `node:test` + `node:assert/strict`).

**Test matrix for `evaluateThreadCreation`:**
1. Lead creating self-owned general thread → `must_delegate`
2. Lead creating self-owned strategy thread → `allowed`
3. Lead creating thread owned by descendant → `allowed`
4. Lead creating Board kickoff thread (self-owned) → `allowed`
5. Non-lead creating self-owned thread → `allowed`
6. Non-lead creating thread owned by other → `denied`

**Test matrix for `evaluateMessagePosting`:**
1. Thread owner posting with runStatus → `allowed`
2. Thread owner posting without runStatus → `allowed`
3. Manager posting review (no runStatus) → `allowed`
4. Manager posting with runStatus → `denied`
5. Unrelated agent posting → `denied`
6. Board posting → `allowed`

**Test matrix for `evaluateThreadStatusChange`:**
1. Thread owner setting any status → `allowed`
2. Manager setting blocked → `allowed`
3. Manager setting completed → `denied`
4. Unrelated agent → `denied`
5. Board → `allowed`

Since the policy module calls DB, tests will need mock/stub for the db parameter. Use simple in-memory stubs that return canned agent/thread rows matching each scenario (same approach as pure-function tests — the policy functions accept `db` as a parameter, so we can inject a mock).

**Step 2: Run tests**

Run: `node --test packages/backend/src/services/governance-policy.test.ts`
Expected: all pass

---

### Task 5: Wire governance checks into `POST /projects/:id/threads`

**Files:**
- Modify: `packages/backend/src/index.ts`
- Test: `pnpm --filter @pixel-org/backend build`

**Step 1: Import and call policy**

After the existing `canAssignThreadOwner` check in `POST /projects/:id/threads`, call `evaluateThreadCreation`. If policy returns `{ allowed: false }`, return HTTP 403 with the policy `reason`.

**Step 2: Accept `taskType` in request body**

Add `taskType` to the destructured body. Validate against allowed values. Pass to `db.insert(threads)`.

**Step 3: Verify build**

Run: `pnpm --filter @pixel-org/backend build`
Expected: PASS

---

### Task 6: Wire governance checks into `POST /threads/:id/messages`

**Files:**
- Modify: `packages/backend/src/index.ts`
- Test: `pnpm --filter @pixel-org/backend build`

**Step 1: Add policy check after agent resolution**

After the existing agent-existence check (line ~1183), call `evaluateMessagePosting` with the resolved agent id, thread id, and runStatus. If denied, return 403 with policy reason.

**Step 2: Keep Board path unchanged**

Board messages (`POST /threads/:id/messages/board`) bypass agent policy — already enforced by separate endpoint that rejects identity fields.

**Step 3: Verify build**

Run: `pnpm --filter @pixel-org/backend build`
Expected: PASS

---

### Task 7: Wire governance checks into `PATCH /threads/:id/status`

**Files:**
- Modify: `packages/backend/src/index.ts`
- Test: `pnpm --filter @pixel-org/backend build`

**Step 1: Replace simple owner check with policy**

Current logic: `if (requesterRow.id !== thread.agentId) → 403`. Replace with `evaluateThreadStatusChange`. This expands allowed actors to include managers for `blocked`/`cancelled`.

**Step 2: Verify build**

Run: `pnpm --filter @pixel-org/backend build`
Expected: PASS

---

### Task 8: Update MCP tools for `taskType`

**Files:**
- Modify: `packages/pixel-mcp-server/server.ts`
- Modify: `packages/pixel-mcp-server/backend.ts`
- Test: `pnpm --filter @pixel-org/pixel-mcp-server build`

**Step 1: Add `taskType` to `pixel_create_thread` tool**

Add optional zod enum param:
```ts
taskType: z.enum(["technical", "operations", "finance", "strategy", "general"])
  .optional()
  .describe("Task domain classification (default: general)")
```

**Step 2: Pass through in backend client**

In `backend.ts` `createThread`, add `taskType` to the POST body.

**Step 3: Verify build**

Run: `pnpm --filter @pixel-org/pixel-mcp-server build`
Expected: PASS

---

### Task 9: Update lead agent template

**Files:**
- Modify: `packages/backend/src/storage/agent-template.ts`
- Test: `pnpm --filter @pixel-org/backend build`

**Step 1: Remove execution loophole**

In `renderLeadOrchestratorAgentsMd`, change:
- Section 1 "Operating Mode": replace "convert requests into clear executable work" with "convert requests into delegated work items for reports"
- Section 4 Phase D: remove "If executing directly, keep scope minimal" option. Replace with clear statement that leads must delegate to reports for execution.
- Section 4 Phase D: add "The backend enforces that leads cannot own operational threads or post execution status updates on report threads."

**Step 2: Add governance section**

Add a new section "## 13) Governance Enforcement" explaining:
- Backend rejects lead-owned operational threads (must delegate)
- Backend rejects execution status updates from leads on non-strategy threads
- Leads can post review/feedback messages on descendant threads
- Board can override any restriction

**Step 3: Verify build**

Run: `pnpm --filter @pixel-org/backend build`
Expected: PASS

---

### Task 10: Final verification

**Files:**
- No new code files

**Step 1: Run all existing tests**

```
node --test packages/backend/src/services/orchestration-contract.test.ts
node --test packages/backend/src/services/thread-message-contract.test.ts
node --test packages/backend/src/services/governance-policy.test.ts
```

Expected: all pass

**Step 2: Run all builds**

```
pnpm --filter @pixel-org/backend build
pnpm --filter @pixel-org/pixel-mcp-server build
pnpm --filter @pixel-org/web build
```

Expected: all pass

**Step 3: Manual smoke test**

1. Lead agent tries to create self-owned general thread → 403 `must_delegate`
2. Lead agent creates thread owned by descendant → 201 success
3. Lead agent posts review message on descendant thread → success
4. Lead agent posts runStatus update on descendant thread → 403 denied
5. Unrelated agent posts on thread → 403 denied
6. Board posts on any thread → success
7. Thread owner posts with runStatus → success
8. Manager sets descendant thread to blocked → success
9. Manager sets descendant thread to completed → 403 denied

---

## Dependency Order

```
Task 1 (schema)
    ↓
Task 2 (relation resolver)
    ↓
Task 3 (policy module) → Task 4 (policy tests) [parallel]
    ↓
Tasks 5, 6, 7 (wire into endpoints) [parallel]
    ↓
Task 8 (MCP tools) — can run parallel with 5-7
    ↓
Task 9 (template update) — independent
    ↓
Task 10 (verification)
```

Tasks 5/6/7 are independent of each other and can be implemented in parallel.
Task 8 can run in parallel with endpoint wiring.
Task 9 is independent and can be done at any point.
