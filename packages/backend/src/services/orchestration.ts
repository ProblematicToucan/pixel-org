import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runAgent } from "@pixel-org/agent-runner";
import { db, agents, projects, messages, agentRunRequests } from "../db/index.js";
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
      `Objective: Kickoff response for project ${request.projectId}`,
      `Run: ${request.id} (${request.reason}, model=${request.model})`,
    ].join("\n"),
  });

  try {
    const task = [
      "A board kickoff thread has been created.",
      `Project ID: ${request.projectId}`,
      `Thread ID: ${request.threadId}`,
      `Reason: ${request.reason}`,
      "Model policy: auto.",
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
  const [existing] = await db
    .select()
    .from(agentRunRequests)
    .where(eq(agentRunRequests.idempotencyKey, idempotencyKey))
    .limit(1);
  if (existing) return;

  const requestId = randomUUID();
  await db.insert(agentRunRequests).values({
    id: requestId,
    projectId: params.projectId,
    threadId: params.threadId,
    agentId: leadAgentId,
    reason: "kickoff_created",
    model: "auto",
    idempotencyKey,
    status: "queued",
  });

  void runQueuedRequest(requestId);
}
