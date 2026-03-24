# Lead Governance Design: Stop Superman Leads

**Date:** 2026-03-24

**Problem:** Lead agents (CEO/CTO/COO) act as superman — executing worker tasks directly, posting operational updates, creating self-owned worker threads, skipping delegation and approval. The current system uses prompt guidance only; nothing enforces role boundaries at the backend level.

**Solution:** Backend-first governance policy engine. Since MCP tools are wrappers around backend HTTP calls, enforcement at the API level automatically propagates to MCP. Skill-level restrictions handle MCP tool surface separately.

---

## Current State Analysis

### What exists (good)

| Control | Location | Status |
|---------|----------|--------|
| Hiring restricted to single lead | `POST /agents/hire` in `index.ts` | Enforced |
| Thread owner assignment requires hierarchy | `canAssignThreadOwner` in `visible-work.ts` | Enforced |
| Approval must be direct manager | `createApprovalRequest` in `approvals.ts` | Enforced |
| Delivery contract (in_progress + completed) | `orchestration-contract.ts` | Enforced |
| Run-level structured status validation | `thread-message-contract.ts` | Enforced |

### What's missing (the gaps)

| Gap | Effect |
|-----|--------|
| No message posting authorization | Any agent posts in any thread (lead does worker work) |
| No thread ownership role validation | Lead creates self-owned operational threads instead of delegating |
| No mandatory delegation gate | Lead executes directly without assigning to reports |
| No task-type routing | No system-level mapping of work domains to role subtrees |
| No approval-required gate | High-risk actions proceed without manager sign-off |
| Lead template says "delegate first, execute when needed" | Loophole: "when needed" is always |

---

## Design

### Core Concept: Centralized Policy Evaluator

A single module (`services/governance-policy.ts`) that every mutating endpoint calls before DB writes. It returns one of:

```
allow          — proceed normally
deny           — reject with reason (403)
must_delegate  — lead must assign to a report, cannot self-execute
requires_approval — blocked until approved approval_request exists
```

### Actor-Target Relationship Model

Reuse existing `getDescendantAgents` tree walker from `visible-work.ts`. Add a resolver:

```
resolveRelation(actorId, targetAgentId) → 
  "self" | "descendant" | "ancestor" | "unrelated"
```

For thread-scoped actions, the "target" is the thread owner.

### Policy Rules (Backend Enforcement)

#### 1. Thread Creation Ownership

**Endpoint:** `POST /projects/:id/threads`

| Actor | Allowed owner | Rule |
|-------|--------------|------|
| Lead (`isLead=true`) | Descendant only | Lead MUST delegate; cannot own operational threads |
| Lead | Self | ONLY for `taskType: strategy` threads |
| Non-lead | Self only | Workers own their own work |

**Exception:** Board kickoff thread (title="Board kickoff") is system-created, always lead-owned.

#### 2. Message Posting Authorization

**Endpoint:** `POST /threads/:id/messages`

| Actor | Thread owner relation | Allowed | Content restriction |
|-------|----------------------|---------|-------------------|
| Thread owner | self | Yes | Full (status updates, work output) |
| Owner's manager (ancestor) | descendant | Yes | Review/feedback only (no run status updates) |
| Board | any | Yes | Directives |
| Unrelated agent | — | No | Denied |
| Lead posting status update on non-strategy thread they don't own descendant of | — | No | Denied |

**Key rule:** Lead agents cannot post `runStatus` updates on threads they don't own (prevents leads from "doing the work" in worker threads). They can post review messages.

#### 3. Thread Status Changes

**Endpoint:** `PATCH /threads/:id/status`

Current: only thread owner or Board can change status. This is already correct. No change needed.

**Addition:** Lead/manager in the owner's chain can also set status to `blocked` or `cancelled` (management override for stuck work).

#### 4. Approval Gates (Phase 2, optional)

For high-risk transitions on threads with `requiresApproval=true`:
- Setting thread to `completed` requires an `approved` approval_request.
- Backend returns 409 with `"requires_approval"` policy reason.

This is additive and can be deferred.

### Task Type Classification

Add `taskType` field to `threads` table:

```
"technical" | "operations" | "finance" | "strategy" | "general"
```

Default: `"general"` (backwards compatible, no migration blocker).

**Routing rule:** When `taskType` is set, thread owner's role subtree should match the domain. This is advisory initially (logged warning), enforceable later.

### Lead Template Update

Update `agent-template.ts` to remove the "execute directly only when needed" loophole:

**Before:** "Delegate first when work belongs to reports; execute directly only when needed."

**After:** "You coordinate, delegate, and review. You do not execute operational tasks. Create threads owned by your reports and review their output."

---

## Files Touched

### New files

| File | Purpose |
|------|---------|
| `packages/backend/src/services/governance-policy.ts` | Central policy evaluator |
| `packages/backend/src/services/governance-policy.test.ts` | Policy matrix tests |
| `packages/backend/drizzle/XXXX_governance_task_type.sql` | Migration: add `task_type` to threads |

### Modified files

| File | Change |
|------|--------|
| `packages/backend/src/db/schema.ts` | Add `taskType` to threads |
| `packages/backend/src/index.ts` | Wire policy checks into `POST /threads/:id/messages`, `POST /projects/:id/threads`, `PATCH /threads/:id/status` |
| `packages/backend/src/services/visible-work.ts` | Export `resolveActorRelation` helper alongside existing `canAssignThreadOwner` |
| `packages/backend/src/storage/agent-template.ts` | Remove "execute directly" loophole from lead template |
| `packages/pixel-mcp-server/server.ts` | Add `taskType` param to `pixel_create_thread` tool |
| `packages/pixel-mcp-server/backend.ts` | Pass `taskType` in `createThread` |

### Unchanged (no breaking changes)

- `approvals.ts` — already correct
- `orchestration.ts` — runs will fail earlier via endpoint denials (good)
- `orchestration-contract.ts` — unchanged
- `thread-message-contract.ts` — unchanged
- `agent-runner/` — unchanged

---

## Backward Compatibility

- `taskType` defaults to `"general"` — existing threads unaffected.
- Message posting adds authorization check — existing non-lead workers posting on their own threads: no change.
- Board identity path: unchanged, always allowed.
- Lead posting review comments on descendant threads: allowed (only `runStatus` updates blocked).
- Kickoff thread: exempted from "lead cannot self-own" rule.

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Breaking lead's current workflow | Phase in: start with message posting auth, add thread ownership rules after |
| Lead cannot respond to urgent issues | Board override path always works; lead can still post review messages |
| Policy module becomes bottleneck | Pure function with DB reads cached per request; no new tables for policy itself |
| Existing tests break | No existing tests for message auth (none exist); new tests cover new behavior |
