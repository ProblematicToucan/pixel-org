import { randomUUID } from "node:crypto";
import { and, eq, lte, or, isNull } from "drizzle-orm";
import { runAgent } from "@pixel-org/agent-runner";
import { db, agents, projects, threads, messages, agentRunRequests } from "../db/index.js";
import { getAgentDir, provisionAgentWorkspace } from "../storage/index.js";

function normalizeKickoffTitle(title: string | null | undefined): string {
  return (title ?? "").trim().toLowerCase();
}

async function resolveLeadAgentId(preferredAgentId: string): Promise<string | null> {
  const [preferred] = await db.select().from(agents).where(eq(agents.id, preferredAgentId)).limit(1);
  if (preferred?.isLead) return preferred.id;
  const [lead] = await db.select().from(agents).where(eq(agents.isLead, true)).limit(1);
  return lead?.id ?? null;
}

async function runQueuedRequest(requestId: string): Promise<void> {
  const [request] = await db.select().from(agentRunRequests).where(eq(agentRunRequests.id, requestId)).limit(1);
  if (!request) return;

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

  // Refresh agent workspace so latest MCP skill/template updates are present before each run.
  provisionAgentWorkspace({
    id: agent.id,
    name: agent.name,
    role: agent.role,
    config: agent.config,
  });

  await db
    .update(agentRunRequests)
    .set({
      status: "running",
      startedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(agentRunRequests.id, request.id));

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
    const task = [
      request.reason === "kickoff_created"
        ? "A board kickoff thread has been created."
        : request.reason === "thread_message"
          ? "A new message was posted in one of your owned threads. Review it and respond with next actions."
          : "You are waking up on a scheduled cycle. First check Pixel MCP for assigned work, then execute highest-priority task.",
      `Project ID: ${request.projectId}`,
      `Thread ID: ${request.threadId}`,
      `Reason: ${request.reason}`,
      "Model policy: auto.",
      "Run protocol:",
      "- Call pixel_get_context first.",
      "- Check projects/threads/messages in Pixel MCP to find work assigned to you.",
      "- If no actionable work exists, post 'Status: Completed' with 'No actionable task found in this cycle'.",
      "- If actionable work exists, post 'Status: In Progress', do the work, then post 'Status: Completed' or 'Status: Blocked'.",
      "You MUST post at least one message to this exact thread using pixel_post_message.",
      "Required first action: call pixel_post_message with 'Status: In Progress' and your immediate plan.",
      "Required final action: call pixel_post_message with either 'Status: Completed' or 'Status: Blocked'.",
      "Read project goals and react in the kickoff thread with an actionable leadership response.",
      project.goals ? `Project goals:\n${project.goals}` : "Project goals are currently empty.",
    ].join("\n");
    const result = await runAgent({
      provider: "cursor",
      role: agent.role,
      task,
      cwd: getAgentDir({ id: agent.id, role: agent.role }),
      timeoutMs: 20 * 60 * 1000,
      agentId: agent.id,
      backendUrl: process.env.PIXEL_BACKEND_URL || "http://localhost:3000",
      env: {
        PIXEL_RUN_REASON: request.reason,
        PIXEL_MODEL: request.model,
      },
    });

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
      const fallback = result.success
        ? [
            "Status: Completed",
            "Objective: Kickoff response",
            "Actions:",
            "- CLI run completed but no thread update was posted by agent.",
            "- Added fallback update for audit continuity.",
            "Next: Re-run with stricter prompt or inspect run stdout/stderr in thread runs endpoint.",
          ].join("\n")
        : [
            "Status: Blocked",
            "Objective: Kickoff response",
            `Reason: Agent CLI run failed (exit=${result.exitCode}${result.timedOut ? ", timed out" : ""}).`,
            `Error: ${result.stderr || "Unknown error"}`,
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
        "Objective: Kickoff response",
        `Reason: Orchestration error while launching agent CLI.`,
        `Error: ${errMsg}`,
      ].join("\n"),
    });
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

  void runQueuedRequest(requestId);
}

async function enqueuePendingFollowupIfNeeded(request: {
  threadId: string;
  projectId: string;
  agentId: string;
}): Promise<void> {
  const [thread] = await db.select().from(threads).where(eq(threads.id, request.threadId)).limit(1);
  if (!thread?.pendingOwnerRun) return;
  if (thread.agentId !== request.agentId) return;

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
  if (ownedThreads.length === 0) return 0;

  const withLatest = await Promise.all(
    ownedThreads.map(async (thread) => {
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
