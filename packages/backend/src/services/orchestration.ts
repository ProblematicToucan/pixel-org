import { randomUUID } from "node:crypto";
import { and, asc, eq, lte, or, isNull } from "drizzle-orm";
import { createCliSession, runAgent } from "@pixel-org/agent-runner";
import type { RunAgentResult } from "@pixel-org/agent-runner";
import { db, agents, projects, threads, messages, agentRunRequests, approvalRequests } from "../db/index.js";
import { ensureAgentProjectLayout, provisionAgentWorkspace } from "../storage/index.js";

function normalizeKickoffTitle(title: string | null | undefined): string {
  return (title ?? "").trim().toLowerCase();
}

/** Only `in_progress` threads trigger kickoff, message-driven, and awake agent runs (avoids runs on not_started / completed / blocked / cancelled). */
function threadStatusAllowsAutomatedAgentRun(status: string | null | undefined): boolean {
  return status === "in_progress";
}

function fallbackObjectiveForRunReason(reason: string): string {
  switch (reason) {
    case "kickoff_created":
      return "Kickoff response";
    case "thread_message":
      return "Respond to thread message";
    case "scheduled_awake":
      return "Scheduled awake run";
    case "approval_pending":
      return "Resolve pending approval request";
    default:
      return "Agent run";
  }
}

/** Builds the headless CLI task string; `continuationMode` toggles strict vs optional `pixel_get_context`. */
function buildOrchestrationAgentTask(params: {
  reason: "kickoff_created" | "scheduled_awake" | "thread_message" | "approval_pending";
  projectId: string;
  threadId: string;
  projectDir: string;
  artifactsDir: string;
  model: string;
  projectGoals: string | null;
  continuationMode: "fresh" | "continuing";
  approvalRequestId?: string | null;
}): string {
  const runProtocolLines =
    params.continuationMode === "fresh"
      ? [
          "Run protocol:",
          "- Call pixel_get_context first.",
          "- Check projects/threads/messages in Pixel MCP to find work assigned to you.",
          "- If no actionable work exists, post only 'Status: Completed' with 'No actionable task found in this cycle' (do not post 'Status: In Progress' first on a no-op).",
          "- If actionable work exists, post 'Status: In Progress', do the work, then post 'Status: Completed' or 'Status: Blocked'.",
        ]
      : [
          "Run protocol:",
          "- You are continuing a headless agent CLI session for this thread. Prefer context already in this session; call pixel_get_context only when you need to refresh backend state (e.g. new messages from others, or a new run reason). Use targeted MCP reads when a partial update is enough.",
          "- Check projects/threads/messages in Pixel MCP to find work assigned to you.",
          "- If no actionable work exists, post only 'Status: Completed' with 'No actionable task found in this cycle' (do not post 'Status: In Progress' first on a no-op).",
          "- If actionable work exists, post 'Status: In Progress', do the work, then post 'Status: Completed' or 'Status: Blocked'.",
        ];

  const leadIn =
    params.reason === "kickoff_created"
      ? "A board kickoff thread has been created."
      : params.reason === "thread_message"
        ? "A new message was posted in one of your owned threads. Review it and respond with next actions."
        : params.reason === "approval_pending"
          ? "You must resolve a pending approval request assigned to you as approver."
          : "You are waking up on a scheduled cycle. First check Pixel MCP for assigned work, then execute highest-priority task.";

  const approvalBlock =
    params.reason === "approval_pending" && params.approvalRequestId
      ? [
          "",
          "Approval workflow (required):",
          `- Approval request ID: ${params.approvalRequestId}`,
          `- Use pixel_list_approval_requests with as=approver and status=pending, or resolve this ID directly.`,
          `- Read pixel_list_messages on this thread for full context.`,
          `- Call pixel_resolve_approval_request with approvalRequestId, decision (approved or rejected), and resolutionNote.`,
          `- After resolving, post a short pixel_post_message on this same thread summarizing the decision for the audit trail (Status: Completed).`,
        ]
      : params.reason === "approval_pending"
        ? [
            "",
            "Approval workflow: use pixel_list_approval_requests, then pixel_resolve_approval_request, then post a summary message on this thread.",
          ]
        : [];

  return [
    leadIn,
    `Your workspace is ${params.projectDir} (Cursor CLI --workspace and cwd). Runtime files are prepared from your agent home: AGENTS.md is linked, while MCP config and skills are local workspace copies; work and clone repos inside this directory unless Pixel MCP requires reading elsewhere.`,
    `Put artifacts and deliverables under ${params.artifactsDir} (subfolder of the project path above).`,
    `Project ID: ${params.projectId}`,
    `Thread ID: ${params.threadId}`,
    `Reason: ${params.reason}`,
    `Model policy: ${params.model}.`,
    ...runProtocolLines,
    ...approvalBlock,
    "You MUST post at least one message to this exact thread using pixel_post_message.",
    "If actionable work exists: first post 'Status: In Progress' with your immediate plan, then end with 'Status: Completed' or 'Status: Blocked' when done.",
    "If there is no actionable work: post a single 'Status: Completed' with 'No actionable task found in this cycle' (do not post 'In Progress' first).",
    params.reason === "kickoff_created"
      ? "Read project goals and react in the kickoff thread with an actionable leadership response."
      : params.reason === "approval_pending"
        ? "You are the approver: decide using project goals, visible work (if applicable), and thread context."
        : "Use the project goals to prioritize work in this thread.",
    params.projectGoals ? `Project goals:\n${params.projectGoals}` : "Project goals are currently empty.",
  ].join("\n");
}

/** DB claim placeholder while provisioning a real CLI session (never pass to `--resume`). */
const SESSION_PENDING_PREFIX = "pixel:pending:" as const;

function isPendingSessionId(id: string | null | undefined): boolean {
  return id != null && id.startsWith(SESSION_PENDING_PREFIX);
}

/** Latest `threads.session_id` for optimistic-lock style checks before mutating a pending claim. */
async function getThreadSessionId(threadId: string): Promise<string | null> {
  const [row] = await db
    .select({ sessionId: threads.sessionId })
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1);
  return row?.sessionId ?? null;
}

/**
 * Resolves `threads.session_id`: returns a real provider session id, using a prefixed pending claim
 * so placeholders are never confused with resumable CLI ids.
 */
async function ensureThreadSessionId(
  threadId: string,
  workspaceDir: string,
  existing: string | null
): Promise<string> {
  const maxRounds = 8;
  let current: string | null = existing;

  for (let round = 0; round < maxRounds; round++) {
    if (current != null && current !== "" && !isPendingSessionId(current)) {
      return current;
    }

    if (current != null && isPendingSessionId(current)) {
      const verifiedBefore = await getThreadSessionId(threadId);
      if (verifiedBefore !== current) {
        current = verifiedBefore;
        continue;
      }
      try {
        const realId = await createCliSession({ cwd: workspaceDir });
        const updated = await db
          .update(threads)
          .set({ sessionId: realId })
          .where(and(eq(threads.id, threadId), eq(threads.sessionId, current)))
          .returning();
        if (updated.length > 0) return realId;
      } catch (err) {
        const verifiedCatch = await getThreadSessionId(threadId);
        if (verifiedCatch === current) {
          await db
            .update(threads)
            .set({ sessionId: null })
            .where(and(eq(threads.id, threadId), eq(threads.sessionId, current)));
        }
        throw err;
      }
      current = await getThreadSessionId(threadId);
      continue;
    }

    const placeholder = `${SESSION_PENDING_PREFIX}${randomUUID()}`;
    const claimed = await db
      .update(threads)
      .set({ sessionId: placeholder })
      .where(and(eq(threads.id, threadId), isNull(threads.sessionId)))
      .returning();
    if (claimed.length > 0) {
      const verifiedClaim = await getThreadSessionId(threadId);
      if (verifiedClaim !== placeholder) {
        current = verifiedClaim;
        continue;
      }
      try {
        const realId = await createCliSession({ cwd: workspaceDir });
        const swapped = await db
          .update(threads)
          .set({ sessionId: realId })
          .where(and(eq(threads.id, threadId), eq(threads.sessionId, placeholder)))
          .returning();
        if (swapped.length > 0) return realId;
      } catch (err) {
        const verifiedCatch = await getThreadSessionId(threadId);
        if (verifiedCatch === placeholder) {
          await db
            .update(threads)
            .set({ sessionId: null })
            .where(and(eq(threads.id, threadId), eq(threads.sessionId, placeholder)));
        }
        throw err;
      }
      current = await getThreadSessionId(threadId);
      continue;
    }

    current = await getThreadSessionId(threadId);
    if (current == null || current === "") {
      continue;
    }
  }

  throw new Error("Failed to resolve thread session_id after retries");
}

/** Substrings that indicate resume/session state is bad — only then clear `threads.session_id`. */
const RESUME_SESSION_INVALIDATION_MARKERS = [
  "cannot resume",
  "session not found",
  "invalid session",
  "session corrupted",
  "checkpoint corrupted",
  "checkpoint mismatch",
  "checkpoint not found",
  "checkpoint state mismatch",
  "state mismatch",
  "invalid session id",
  "unknown session",
  "chat not found",
  "no such chat",
  "expired session",
  "failed to resume",
] as const;

/**
 * When a resume run fails, clear stored `session_id` only if stderr matches resume/session
 * corruption signals (allowlist). Other failures keep the session so transient errors do not wipe context.
 */
function shouldInvalidateStoredSessionOnFailure(
  stderr: string | undefined | null,
  _exitCode: number,
  timedOut?: boolean
): boolean {
  if (timedOut) return false;
  const raw = (stderr ?? "").trim().toLowerCase();
  for (const m of RESUME_SESSION_INVALIDATION_MARKERS) {
    if (raw.includes(m)) return true;
  }
  return false;
}

/**
 * stderr from `agent` (Cursor CLI) — often upstream HTTP 504 / unavailable, not Pixel backend.
 * Produces readable thread text without duplicated "Error:" prefixes.
 */
function formatAgentCliFailureForThread(stderr: string | undefined | null, exitCode: number): string {
  const raw = (stderr ?? "").trim() || "Unknown error";
  const cleaned = raw.replace(/^(Error:\s*)+/i, "").trim();
  const parts = [`Detail: ${cleaned}`, `Exit code: ${exitCode}`];
  const lower = cleaned.toLowerCase();
  if (
    lower.includes("504") ||
    lower.includes("502") ||
    lower.includes("503") ||
    lower.includes("unavailable") ||
    lower.includes("gateway timeout") ||
    lower.includes("econnrefused")
  ) {
    parts.push(
      "Likely cause: Cursor Agent CLI could not reach Cursor’s cloud API (timeout, outage, or rate limit). This is not the Pixel backend failing. Retry later; check network, Cursor status, and `agent` CLI login."
    );
  }
  return parts.join("\n");
}

const MAX_CONCURRENT_AGENT_RUNS = Number(process.env.PIXEL_MAX_CONCURRENT_AGENT_RUNS ?? "4");
const EFFECTIVE_MAX_CONCURRENT_AGENT_RUNS = Number.isFinite(MAX_CONCURRENT_AGENT_RUNS)
  ? Math.max(1, Math.floor(MAX_CONCURRENT_AGENT_RUNS))
  : 4;
let dispatcherScheduled = false;
let activeProcessCount = 0;
const runningAgentIds = new Set<string>();

async function resolveLeadAgentId(preferredAgentId: string): Promise<string | null> {
  const [preferred] = await db.select().from(agents).where(eq(agents.id, preferredAgentId)).limit(1);
  if (preferred?.isLead) return preferred.id;
  const [lead] = await db.select().from(agents).where(eq(agents.isLead, true)).limit(1);
  return lead?.id ?? null;
}

function scheduleQueueDispatcher(): void {
  if (dispatcherScheduled) return;
  dispatcherScheduled = true;
  setTimeout(() => {
    dispatcherScheduled = false;
    void drainQueuedRequests().catch((err) => {
      console.error("Queue dispatcher failed:", err);
    });
  }, 0);
}

async function tryStartNextQueuedRequest(): Promise<boolean> {
  if (activeProcessCount >= EFFECTIVE_MAX_CONCURRENT_AGENT_RUNS) return false;

  const queued = await db
    .select({
      id: agentRunRequests.id,
      agentId: agentRunRequests.agentId,
    })
    .from(agentRunRequests)
    .where(eq(agentRunRequests.status, "queued"))
    .orderBy(asc(agentRunRequests.createdAt))
    .limit(50);
  if (queued.length === 0) return false;

  for (const candidate of queued) {
    if (runningAgentIds.has(candidate.agentId)) continue;

    const now = new Date();
    const claimed = await db
      .update(agentRunRequests)
      .set({
        status: "running",
        startedAt: now,
        updatedAt: now,
      })
      .where(and(eq(agentRunRequests.id, candidate.id), eq(agentRunRequests.status, "queued")))
      .returning();

    if (claimed.length === 0) continue;

    activeProcessCount += 1;
    runningAgentIds.add(candidate.agentId);
    void runQueuedRequest(candidate.id, candidate.agentId);
    return true;
  }

  return false;
}

async function drainQueuedRequests(): Promise<void> {
  while (
    activeProcessCount < EFFECTIVE_MAX_CONCURRENT_AGENT_RUNS &&
    (await tryStartNextQueuedRequest())
  ) {
    // keep draining until no additional request can be claimed.
  }
}

/**
 * Drop queued approval_pending runs for this approval id.
 * Does not mark `running` rows (CLI may still be active); those exit early when approval is no longer pending.
 */
export async function cancelApprovalRunsForRequest(approvalRequestId: string): Promise<void> {
  await db
    .update(agentRunRequests)
    .set({
      status: "cancelled",
      error: "Approval request cancelled",
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentRunRequests.approvalRequestId, approvalRequestId),
        eq(agentRunRequests.status, "queued")
      )
    );
}

async function runQueuedRequest(requestId: string, claimedAgentId?: string): Promise<void> {
  const [request] = await db.select().from(agentRunRequests).where(eq(agentRunRequests.id, requestId)).limit(1);
  if (!request) {
    if (claimedAgentId) {
      runningAgentIds.delete(claimedAgentId);
      activeProcessCount = Math.max(0, activeProcessCount - 1);
      scheduleQueueDispatcher();
    }
    return;
  }

  if (request.status === "cancelled") {
    const ownerAgentId = claimedAgentId ?? request.agentId;
    runningAgentIds.delete(ownerAgentId);
    activeProcessCount = Math.max(0, activeProcessCount - 1);
    scheduleQueueDispatcher();
    return;
  }

  const [agent] = await db.select().from(agents).where(eq(agents.id, request.agentId)).limit(1);
  const [project] = await db.select().from(projects).where(eq(projects.id, request.projectId)).limit(1);
  if (!agent || !project) {
    await db
      .update(agentRunRequests)
      .set({
        status: "failed",
        error: "Missing agent or project for run request",
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agentRunRequests.id, request.id));

    await enqueuePendingFollowupIfNeeded({
      threadId: request.threadId,
      projectId: request.projectId,
      agentId: request.agentId,
    });
    return;
  }

  const [threadRow] = await db.select().from(threads).where(eq(threads.id, request.threadId)).limit(1);
  if (!threadRow || !threadStatusAllowsAutomatedAgentRun(threadRow.status)) {
    const errDetail = !threadRow
      ? "Thread not found for run request"
      : `Automated agent runs require thread status in_progress (current: ${threadRow.status})`;
    await db
      .update(agentRunRequests)
      .set({
        status: "failed",
        error: errDetail,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agentRunRequests.id, request.id));
    const ownerAgentId = claimedAgentId ?? request.agentId;
    runningAgentIds.delete(ownerAgentId);
    activeProcessCount = Math.max(0, activeProcessCount - 1);
    scheduleQueueDispatcher();
    return;
  }

  if (request.reason === "approval_pending" && request.approvalRequestId) {
    const [ap] = await db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, request.approvalRequestId))
      .limit(1);
    if (!ap || ap.status !== "pending") {
      await db
        .update(agentRunRequests)
        .set({
          status: "done",
          error: null,
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(agentRunRequests.id, request.id), eq(agentRunRequests.status, "running")));
      const ownerEarly = claimedAgentId ?? request.agentId;
      runningAgentIds.delete(ownerEarly);
      activeProcessCount = Math.max(0, activeProcessCount - 1);
      scheduleQueueDispatcher();
      return;
    }
  }

  // Refresh agent workspace so latest MCP skill/template updates are present before each run.
  provisionAgentWorkspace({
    id: agent.id,
    name: agent.name,
    role: agent.role,
    config: agent.config,
  });

  const { projectDir, artifactsDir } = ensureAgentProjectLayout(
    { id: agent.id, role: agent.role },
    request.projectId
  );

  const beforeStartMessages = await db.select().from(messages).where(eq(messages.threadId, request.threadId));
  const baselineAgentMessageCount = beforeStartMessages.filter((m) => m.agentId === agent.id).length;

  await db.insert(messages).values({
    threadId: request.threadId,
    agentId: agent.id,
    actorType: "agent",
    actorName: agent.name,
    content: [
      "Status: Started",
      `Objective: ${fallbackObjectiveForRunReason(request.reason)} for project ${request.projectId}`,
      `Run: ${request.id} (${request.reason}, model=${request.model})`,
    ].join("\n"),
  });

  try {
    const actorIsOwner = request.agentId === threadRow.agentId;
    const hadStoredSessionId =
      actorIsOwner && !!threadRow.sessionId && !isPendingSessionId(threadRow.sessionId);
    let pendingExisting: string | null = actorIsOwner ? threadRow.sessionId : null;

    let result!: RunAgentResult;
    for (let attempt = 1; attempt <= 2; attempt++) {
      let sessionId: string;
      let continuationMode: "fresh" | "continuing";
      if (actorIsOwner) {
        sessionId = await ensureThreadSessionId(request.threadId, projectDir, pendingExisting);
        continuationMode = hadStoredSessionId && attempt === 1 ? "continuing" : "fresh";
      } else {
        sessionId = await createCliSession({ cwd: projectDir });
        continuationMode = "fresh";
      }

      const task = buildOrchestrationAgentTask({
        reason: request.reason as "kickoff_created" | "thread_message" | "scheduled_awake" | "approval_pending",
        projectId: request.projectId,
        threadId: request.threadId,
        projectDir,
        artifactsDir,
        model: request.model,
        projectGoals: project.goals,
        continuationMode,
        approvalRequestId: request.approvalRequestId ?? null,
      });

      result = await runAgent({
        provider: "cursor",
        role: agent.role,
        task,
        cwd: projectDir,
        timeoutMs: 20 * 60 * 1000,
        agentId: agent.id,
        backendUrl: process.env.PIXEL_BACKEND_URL || "http://localhost:3000",
        model: request.model,
        resumeSessionId: sessionId,
        env: {
          PIXEL_RUN_REASON: request.reason,
          PIXEL_PROJECT_ID: request.projectId,
          PIXEL_PROJECT_WORKSPACE: projectDir,
          PIXEL_PROJECT_ARTIFACTS: artifactsDir,
          ...(request.approvalRequestId
            ? { PIXEL_APPROVAL_REQUEST_ID: request.approvalRequestId }
            : {}),
        },
        onSpawn: ({ pid, command, args }) => {
          void db
            .update(agentRunRequests)
            .set({
              pid: pid ?? null,
              command: command ?? null,
              args: args ? JSON.stringify(args) : null,
              updatedAt: new Date(),
            })
            .where(eq(agentRunRequests.id, request.id));
        },
      });

      if (result.success) break;
      if (
        actorIsOwner &&
        attempt === 1 &&
        hadStoredSessionId &&
        shouldInvalidateStoredSessionOnFailure(result.stderr, result.exitCode, result.timedOut)
      ) {
        await db
          .update(threads)
          .set({ sessionId: null })
          .where(
            and(eq(threads.id, request.threadId), eq(threads.sessionId, sessionId))
          );
        pendingExisting = null;
        continue;
      }
      break;
    }

    const completionUpdate = await db
      .update(agentRunRequests)
      .set({
        status: result.success ? "done" : "failed",
        error: result.success ? null : (result.stderr || "Agent run failed"),
        pid: result.pid ?? null,
        command: result.command ?? null,
        args: result.args ? JSON.stringify(result.args) : null,
        exitCode: result.exitCode,
        stdout: result.stdout || null,
        stderr: result.stderr || null,
        timedOut: result.timedOut === true,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(agentRunRequests.id, request.id), eq(agentRunRequests.status, "running")))
      .returning();

    if (completionUpdate.length > 0) {
      const msgs = await db.select().from(messages).where(eq(messages.threadId, request.threadId));
      const agentMessageCount = msgs.filter((m) => m.agentId === agent.id).length;
      const hasAgentReply = agentMessageCount > baselineAgentMessageCount + 1;
      if (!hasAgentReply) {
        const obj = fallbackObjectiveForRunReason(request.reason);
        const fallback = result.success
          ? [
              "Status: Completed",
              `Objective: ${obj}`,
              "Actions:",
              "- CLI run completed but no thread update was posted by agent.",
              "- Added fallback update for audit continuity.",
              "Next: Re-run with stricter prompt or inspect run stdout/stderr in thread runs endpoint.",
            ].join("\n")
          : [
              "Status: Blocked",
              `Objective: ${obj}`,
              `Reason: Agent CLI run failed (exit=${result.exitCode}${result.timedOut ? ", timed out" : ""}).`,
              formatAgentCliFailureForThread(result.stderr, result.exitCode),
            ].join("\n");
        await db.insert(messages).values({
          threadId: request.threadId,
          agentId: agent.id,
          actorType: "agent",
          actorName: agent.name,
          content: fallback,
        });
      }
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown orchestration error";
    await db
      .update(agentRunRequests)
      .set({
        status: "failed",
        error: errMsg,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(agentRunRequests.id, request.id), eq(agentRunRequests.status, "running")));
    await enqueuePendingFollowupIfNeeded({
      threadId: request.threadId,
      projectId: request.projectId,
      agentId: request.agentId,
    });
    await db.insert(messages).values({
      threadId: request.threadId,
      agentId: agent.id,
      actorType: "agent",
      actorName: agent.name,
      content: [
        "Status: Blocked",
        `Objective: ${fallbackObjectiveForRunReason(request.reason)}`,
        `Reason: Orchestration error while launching agent CLI.`,
        `Detail: ${errMsg}`,
      ].join("\n"),
    });
  } finally {
    const ownerAgentId = claimedAgentId ?? request.agentId;
    runningAgentIds.delete(ownerAgentId);
    activeProcessCount = Math.max(0, activeProcessCount - 1);
    scheduleQueueDispatcher();
  }
}

async function enqueueRun(params: {
  projectId: string;
  threadId: string;
  agentId: string;
  reason: "kickoff_created" | "scheduled_awake" | "thread_message" | "approval_pending";
  idempotencyKey: string;
  approvalRequestId?: string | null;
}): Promise<void> {
  const requestId = randomUUID();
  const inserted = await db
    .insert(agentRunRequests)
    .values({
      id: requestId,
      projectId: params.projectId,
      threadId: params.threadId,
      agentId: params.agentId,
      reason: params.reason,
      model: "auto",
      idempotencyKey: params.idempotencyKey,
      status: "queued",
      approvalRequestId: params.approvalRequestId ?? null,
    })
    .onConflictDoNothing({ target: agentRunRequests.idempotencyKey })
    .returning();

  if (inserted.length > 0) {
    scheduleQueueDispatcher();
  }
}

/** Enqueue the approver agent to process a pending approval (durable inbox + wake). */
export async function enqueueApprovalPendingRun(params: {
  projectId: string;
  sourceThreadId: string;
  approverAgentId: string;
  approvalRequestId: string;
}): Promise<void> {
  const idempotencyKey = `approval_pending:${params.approvalRequestId}`;
  await enqueueRun({
    projectId: params.projectId,
    threadId: params.sourceThreadId,
    agentId: params.approverAgentId,
    reason: "approval_pending",
    idempotencyKey,
    approvalRequestId: params.approvalRequestId,
  });
}

async function enqueuePendingFollowupIfNeeded(request: {
  threadId: string;
  projectId: string;
  agentId: string;
}): Promise<void> {
  const [thread] = await db.select().from(threads).where(eq(threads.id, request.threadId)).limit(1);
  if (!thread?.pendingOwnerRun) return;
  if (thread.agentId !== request.agentId) return;
  if (!threadStatusAllowsAutomatedAgentRun(thread.status)) return;

  const [activeForOwner] = await db
    .select()
    .from(agentRunRequests)
    .where(
      and(
        eq(agentRunRequests.agentId, request.agentId),
        or(eq(agentRunRequests.status, "queued"), eq(agentRunRequests.status, "running"))
      )
    )
    .limit(1);
  if (activeForOwner) {
    await db.update(threads).set({ pendingOwnerRun: true }).where(eq(threads.id, thread.id));
    return;
  }

  await db.update(threads).set({ pendingOwnerRun: false }).where(eq(threads.id, request.threadId));

  await enqueueRun({
    projectId: request.projectId,
    threadId: request.threadId,
    agentId: request.agentId,
    reason: "thread_message",
    idempotencyKey: `thread_message_followup:${request.projectId}:${request.threadId}:${request.agentId}:${Date.now()}`,
  });
}

export async function enqueueKickoffLeadRun(params: {
  projectId: string;
  threadId: string;
  title: string | null | undefined;
  preferredAgentId: string;
}): Promise<void> {
  if (normalizeKickoffTitle(params.title) !== "board kickoff") return;
  const leadAgentId = await resolveLeadAgentId(params.preferredAgentId);
  if (!leadAgentId) return;

  const [thread] = await db.select().from(threads).where(eq(threads.id, params.threadId)).limit(1);
  if (!thread || !threadStatusAllowsAutomatedAgentRun(thread.status)) return;

  const idempotencyKey = `kickoff_spawn:${params.projectId}:${params.threadId}:${leadAgentId}`;  
  await enqueueRun({
    projectId: params.projectId,
    threadId: params.threadId,
    agentId: leadAgentId,
    reason: "kickoff_created",
    idempotencyKey,
  });
}

export async function enqueueThreadOwnerRunOnMessage(params: {
  threadId: string;
  messageId: string;
  actorType: "agent" | "board";
  actorAgentId: string | null;
}): Promise<void> {
  const [thread] = await db.select().from(threads).where(eq(threads.id, params.threadId)).limit(1);
  if (!thread) return;
  if (!threadStatusAllowsAutomatedAgentRun(thread.status)) return;

  // Avoid self-trigger loops when owner posts progress/status.
  if (params.actorType === "agent" && params.actorAgentId === thread.agentId) {
    return;
  }

  const [activeForOwner] = await db
    .select()
    .from(agentRunRequests)
    .where(
      and(
        eq(agentRunRequests.agentId, thread.agentId),
        or(eq(agentRunRequests.status, "queued"), eq(agentRunRequests.status, "running"))
      )
    )
    .limit(1);
  if (activeForOwner) return;

  const idempotencyKey = `thread_message:${thread.projectId}:${thread.id}:${params.messageId}:${thread.agentId}`;
  await enqueueRun({
    projectId: thread.projectId,
    threadId: thread.id,
    agentId: thread.agentId,
    reason: "thread_message",
    idempotencyKey,
  });
}

function computeNextAwakeAt(now: Date, intervalMinutes: number): Date {
  return new Date(now.getTime() + Math.max(3, Math.floor(intervalMinutes)) * 60_000);
}

function isTerminalStatus(content: string): boolean {
  const normalized = content.trim().toLowerCase();
  return normalized.startsWith("status: completed") || normalized.startsWith("status: blocked");
}

async function hasTerminalAgentMessageSinceStart(request: typeof agentRunRequests.$inferSelect): Promise<boolean> {
  if (!request.startedAt) return false;
  const threadMessages = await db.select().from(messages).where(eq(messages.threadId, request.threadId));
  return threadMessages.some((m) => {
    if (m.actorType !== "agent" || m.agentId !== request.agentId) return false;
    if (new Date(m.createdAt).getTime() < new Date(request.startedAt as Date).getTime()) return false;
    return isTerminalStatus(m.content);
  });
}

export async function reconcileActiveRuns(now = new Date()): Promise<{ reconciledDone: number; reconciledFailed: number }> {
  const active = await db
    .select()
    .from(agentRunRequests)
    .where(or(eq(agentRunRequests.status, "queued"), eq(agentRunRequests.status, "running")));
  let reconciledDone = 0;
  let reconciledFailed = 0;

  for (const request of active) {
    // queued rows are left untouched; they can legitimately wait behind current work.
    if (request.status !== "running") continue;

    if (await hasTerminalAgentMessageSinceStart(request)) {
      await db
        .update(agentRunRequests)
        .set({
          status: "done",
          error: null,
          finishedAt: now,
          updatedAt: now,
        })
        .where(eq(agentRunRequests.id, request.id));
      reconciledDone += 1;
      continue;
    }

    if (request.startedAt) {
      const startedAtMs = new Date(request.startedAt).getTime();
      const staleAfterMs = 22 * 60 * 1000; // runtime timeout (20m) + grace window (2m)
      if (now.getTime() - startedAtMs > staleAfterMs) {
        await db
          .update(agentRunRequests)
          .set({
            status: "failed",
            timedOut: true,
            error: request.error || "Run reconciled as stale: exceeded timeout without process completion signal",
            finishedAt: now,
            updatedAt: now,
          })
          .where(eq(agentRunRequests.id, request.id));
        reconciledFailed += 1;
      }
    }
  }

  return { reconciledDone, reconciledFailed };
}

const rawReconcileReadCooldownMs = Number(process.env.PIXEL_RECONCILE_ACTIVE_RUNS_MIN_MS ?? "5000");
const RECONCILE_READ_COOLDOWN_MS = Number.isFinite(rawReconcileReadCooldownMs)
  ? Math.max(0, Math.floor(rawReconcileReadCooldownMs))
  : 5000;
let lastReconcileForReadAt = 0;

/**
 * Throttled reconciliation for read-heavy endpoints (e.g. GET /runs/active).
 * Awake scheduler and explicit orchestration calls use {@link reconcileActiveRuns} directly.
 */
export async function reconcileActiveRunsForReadEndpoint(now = new Date()): Promise<void> {
  const nowMs = now.getTime();
  if (
    RECONCILE_READ_COOLDOWN_MS > 0 &&
    nowMs - lastReconcileForReadAt < RECONCILE_READ_COOLDOWN_MS
  ) {
    return;
  }
  lastReconcileForReadAt = nowMs;
  await reconcileActiveRuns(now);
}

async function enqueueAwakeRunsForAgent(agentId: string): Promise<number> {
  const [activeForAgent] = await db
    .select()
    .from(agentRunRequests)
    .where(
      and(
        eq(agentRunRequests.agentId, agentId),
        or(eq(agentRunRequests.status, "queued"), eq(agentRunRequests.status, "running"))
      )
    )
    .limit(1);
  if (activeForAgent) return 0;

  const ownedThreads = await db.select().from(threads).where(eq(threads.agentId, agentId));
  const activeThreads = ownedThreads.filter((t) => threadStatusAllowsAutomatedAgentRun(t.status));
  if (activeThreads.length === 0) return 0;

  const withLatest = await Promise.all(
    activeThreads.map(async (thread) => {
      const threadMessages = await db.select().from(messages).where(eq(messages.threadId, thread.id));
      const sorted = [...threadMessages].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      return { thread, latest: sorted[0] ?? null };
    })
  );

  // Prefer non-terminal threads; fallback to most recently active assigned thread.
  const prioritized = [...withLatest].sort((a, b) => {
    const aTs = a.latest ? new Date(a.latest.createdAt).getTime() : 0;
    const bTs = b.latest ? new Date(b.latest.createdAt).getTime() : 0;
    return bTs - aTs;
  });
  const nonTerminal = prioritized.find((x) => x.latest && !isTerminalStatus(x.latest.content));
  const target = nonTerminal ?? prioritized[0];
  if (!target) return 0;

  const marker = target.latest?.id ?? "no-message";
  const idempotencyKey = `awake:${agentId}:${target.thread.id}:${marker}:${Math.floor(Date.now() / 60000)}`;
  await enqueueRun({
    projectId: target.thread.projectId,
    threadId: target.thread.id,
    agentId,
    reason: "scheduled_awake",
    idempotencyKey,
  });
  return 1;
}

export async function runAwakeCycle(now = new Date()): Promise<{ dueAgents: number; enqueuedRuns: number }> {
  await reconcileActiveRuns(now);
  const dueAgents = await db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.awakeEnabled, true),
        or(isNull(agents.nextAwakeAt), lte(agents.nextAwakeAt, now))
      )
    );

  let enqueuedRuns = 0;
  for (const agent of dueAgents) {
    const nextAt = computeNextAwakeAt(now, agent.awakeIntervalMinutes);
    await db
      .update(agents)
      .set({
        lastAwakeAt: now,
        nextAwakeAt: nextAt,
        updatedAt: now,
      })
      .where(eq(agents.id, agent.id));
    enqueuedRuns += await enqueueAwakeRunsForAgent(agent.id);
  }

  return { dueAgents: dueAgents.length, enqueuedRuns };
}

export function startAwakeScheduler(pollMs = 30_000): NodeJS.Timeout {
  return setInterval(() => {
    void runAwakeCycle().catch((err) => {
      console.error("Awake scheduler cycle failed:", err);
    });
  }, Math.max(5_000, pollMs));
}
