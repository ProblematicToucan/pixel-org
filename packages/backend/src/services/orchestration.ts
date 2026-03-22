import { randomUUID } from "node:crypto";
import { and, asc, eq, lte, or, isNull } from "drizzle-orm";
import { createCliSession, runAgent } from "@pixel-org/agent-runner";
import type { RunAgentResult } from "@pixel-org/agent-runner";
import { db, agents, projects, threads, messages, agentRunRequests } from "../db/index.js";
import {
  ensureAgentProjectLayout,
  getAgentDir,
  provisionAgentWorkspace,
} from "../storage/index.js";

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
    default:
      return "Agent run";
  }
}

/** Builds the headless CLI task string; `continuationMode` toggles strict vs optional `pixel_get_context`. */
function buildOrchestrationAgentTask(params: {
  reason: "kickoff_created" | "scheduled_awake" | "thread_message";
  projectId: string;
  threadId: string;
  projectDir: string;
  artifactsDir: string;
  model: string;
  projectGoals: string | null;
  continuationMode: "fresh" | "continuing";
}): string {
  const runProtocolLines =
    params.continuationMode === "fresh"
      ? [
          "Run protocol:",
          "- Call pixel_get_context first.",
          "- Check projects/threads/messages in Pixel MCP to find work assigned to you.",
          "- If no actionable work exists, post 'Status: Completed' with 'No actionable task found in this cycle'.",
          "- If actionable work exists, post 'Status: In Progress', do the work, then post 'Status: Completed' or 'Status: Blocked'.",
        ]
      : [
          "Run protocol:",
          "- You are continuing a headless agent CLI session for this thread. Prefer context already in this session; call pixel_get_context only when you need to refresh backend state (e.g. new messages from others, or a new run reason). Use targeted MCP reads when a partial update is enough.",
          "- Check projects/threads/messages in Pixel MCP to find work assigned to you.",
          "- If no actionable work exists, post 'Status: Completed' with 'No actionable task found in this cycle'.",
          "- If actionable work exists, post 'Status: In Progress', do the work, then post 'Status: Completed' or 'Status: Blocked'.",
        ];

  return [
    params.reason === "kickoff_created"
      ? "A board kickoff thread has been created."
      : params.reason === "thread_message"
        ? "A new message was posted in one of your owned threads. Review it and respond with next actions."
        : "You are waking up on a scheduled cycle. First check Pixel MCP for assigned work, then execute highest-priority task.",
    `Your workspace is ${params.projectDir} (project path). Work only inside this directory for any local file creation or edits for this project.`,
    `Put artifacts and deliverables under ${params.artifactsDir} (subfolder of the project path above).`,
    `The agent CLI may be spawned with a different cwd (your agent home) for MCP/skills; still treat the project path above as the only writable project workspace unless Pixel MCP explicitly requires reading elsewhere.`,
    `Project ID: ${params.projectId}`,
    `Thread ID: ${params.threadId}`,
    `Reason: ${params.reason}`,
    `Model policy: ${params.model}.`,
    ...runProtocolLines,
    "You MUST post at least one message to this exact thread using pixel_post_message.",
    "Required first action: call pixel_post_message with 'Status: In Progress' and your immediate plan.",
    "Required final action: call pixel_post_message with either 'Status: Completed' or 'Status: Blocked'.",
    "Read project goals and react in the kickoff thread with an actionable leadership response.",
    params.projectGoals ? `Project goals:\n${params.projectGoals}` : "Project goals are currently empty.",
  ].join("\n");
}

/**
 * Resolves `threads.session_id`: returns an existing non-empty id, or creates a session and
 * claims the row with `UPDATE ... WHERE session_id IS NULL` so concurrent workers do not overwrite.
 */
async function ensureThreadSessionId(
  threadId: string,
  agentDir: string,
  existing: string | null
): Promise<string> {
  if (existing != null && existing !== "") return existing;
  const newId = await createCliSession({ cwd: agentDir });
  const claimed = await db
    .update(threads)
    .set({ sessionId: newId })
    .where(and(eq(threads.id, threadId), isNull(threads.sessionId)))
    .returning();
  if (claimed.length > 0) return newId;
  const [row] = await db
    .select({ sessionId: threads.sessionId })
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1);
  if (row?.sessionId != null && row.sessionId !== "") return row.sessionId;
  throw new Error("Failed to claim or read thread session_id");
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
      `Objective: ${
        request.reason === "kickoff_created"
          ? "Kickoff response"
          : request.reason === "thread_message"
            ? "Respond to new thread message"
            : "Awake check and task execution"
      } for project ${request.projectId}`,
      `Run: ${request.id} (${request.reason}, model=${request.model})`,
    ].join("\n"),
  });

  try {
    const agentDir = getAgentDir({ id: agent.id, role: agent.role });
    const hadStoredSessionId = !!threadRow.sessionId;
    let pendingExisting: string | null = threadRow.sessionId;

    let result!: RunAgentResult;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const sessionId = await ensureThreadSessionId(
        request.threadId,
        agentDir,
        pendingExisting
      );

      const continuationMode =
        hadStoredSessionId && attempt === 1 ? "continuing" : "fresh";
      const task = buildOrchestrationAgentTask({
        reason: request.reason as "kickoff_created" | "thread_message" | "scheduled_awake",
        projectId: request.projectId,
        threadId: request.threadId,
        projectDir,
        artifactsDir,
        model: request.model,
        projectGoals: project.goals,
        continuationMode,
      });

      result = await runAgent({
        provider: "cursor",
        role: agent.role,
        task,
        cwd: agentDir,
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
      if (attempt === 1 && hadStoredSessionId) {
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

    await db
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
      .where(eq(agentRunRequests.id, request.id));

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
      .where(eq(agentRunRequests.id, request.id));
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
  reason: "kickoff_created" | "scheduled_awake" | "thread_message";
  idempotencyKey: string;
}): Promise<void> {
  const [existing] = await db
    .select()
    .from(agentRunRequests)
    .where(eq(agentRunRequests.idempotencyKey, params.idempotencyKey))
    .limit(1);
  if (existing) return;

  const requestId = randomUUID();
  await db.insert(agentRunRequests).values({
    id: requestId,
    projectId: params.projectId,
    threadId: params.threadId,
    agentId: params.agentId,
    reason: params.reason,
    model: "auto",
    idempotencyKey: params.idempotencyKey,
    status: "queued",
  });

  scheduleQueueDispatcher();
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
