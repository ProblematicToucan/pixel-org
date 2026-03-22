import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db, agents, approvalRequests, threads, messages } from "../db/index.js";
import { enqueueApprovalPendingRun, enqueueThreadOwnerRunOnMessage } from "./orchestration.js";
import { emitThreadMessage } from "../threadMessageSse.js";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";

export async function createApprovalRequest(input: {
  requesterAgentId: string;
  projectId: string;
  sourceThreadId: string;
  summary: string;
  approverAgentId?: string | null;
  metadata?: string | null;
  idempotencyKey?: string | null;
}): Promise<{ created: boolean; approval: typeof approvalRequests.$inferSelect }> {
  const idempotencyKey = String(input.idempotencyKey ?? randomUUID()).trim();

  const [existing] = await db
    .select()
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.requesterAgentId, input.requesterAgentId),
        eq(approvalRequests.sourceThreadId, input.sourceThreadId),
        eq(approvalRequests.idempotencyKey, idempotencyKey)
      )
    )
    .limit(1);
  if (existing) {
    return { created: false, approval: existing };
  }

  const [thread] = await db.select().from(threads).where(eq(threads.id, input.sourceThreadId)).limit(1);
  if (!thread) {
    throw new Error("Thread not found");
  }
  if (thread.projectId !== input.projectId) {
    throw new Error("projectId does not match thread");
  }
  if (thread.agentId !== input.requesterAgentId) {
    throw new Error("Only the thread owner may create an approval request on this thread");
  }
  if (thread.status !== "in_progress") {
    throw new Error("Thread must be in_progress for approval orchestration");
  }

  const [requester] = await db.select().from(agents).where(eq(agents.id, input.requesterAgentId)).limit(1);
  if (!requester) {
    throw new Error("Requester agent not found");
  }

  const approverFromInput = input.approverAgentId?.trim() ?? "";
  const approverId = approverFromInput !== "" ? approverFromInput : (requester.parentId ?? "");
  if (!approverId) {
    throw new Error("Approver required: pass approverAgentId or set requester's parent_id (direct manager)");
  }
  if (approverId !== requester.parentId) {
    throw new Error("approverAgentId must be the requester's direct manager (parent_id)");
  }

  const [approver] = await db.select().from(agents).where(eq(agents.id, approverId)).limit(1);
  if (!approver) {
    throw new Error("Approver agent not found");
  }

  const id = randomUUID();
  const [inserted] = await db
    .insert(approvalRequests)
    .values({
      id,
      projectId: input.projectId,
      sourceThreadId: input.sourceThreadId,
      requesterAgentId: input.requesterAgentId,
      approverAgentId: approverId,
      summary: input.summary.trim(),
      status: "pending",
      idempotencyKey,
      metadata: input.metadata?.trim() || null,
    })
    .returning();

  if (!inserted) {
    throw new Error("Failed to create approval request");
  }

  const messageId = randomUUID();
  const createdAtCreate = new Date();
  const insertedCreate = {
    id: messageId,
    threadId: input.sourceThreadId,
    agentId: input.requesterAgentId,
    actorType: "agent" as const,
    actorName: requester.name,
    content: [
      `[Approval requested] id=${id}`,
      `Summary: ${input.summary.trim()}`,
      `Approver: ${approver.name} (${approverId})`,
    ].join("\n"),
    createdAt: createdAtCreate,
  };
  await db.insert(messages).values(insertedCreate);
  emitThreadMessage(input.sourceThreadId, {
    ...insertedCreate,
    createdAt: createdAtCreate.toISOString(),
  });

  await enqueueApprovalPendingRun({
    projectId: input.projectId,
    sourceThreadId: input.sourceThreadId,
    approverAgentId: approverId,
    approvalRequestId: id,
  });

  return { created: true, approval: inserted };
}

export async function listApprovalRequestsForAgent(params: {
  agentId: string;
  as: "approver" | "requester";
  status?: ApprovalStatus;
}): Promise<(typeof approvalRequests.$inferSelect)[]> {
  const roleCond =
    params.as === "approver"
      ? eq(approvalRequests.approverAgentId, params.agentId)
      : eq(approvalRequests.requesterAgentId, params.agentId);
  const conditions = [roleCond];
  if (params.status) {
    conditions.push(eq(approvalRequests.status, params.status));
  }
  return db
    .select()
    .from(approvalRequests)
    .where(and(...conditions))
    .orderBy(desc(approvalRequests.createdAt));
}

export async function resolveApprovalRequest(input: {
  approvalId: string;
  resolverAgentId: string;
  decision: "approved" | "rejected";
  resolutionNote?: string | null;
}): Promise<{ success: boolean }> {
  const [row] = await db
    .select()
    .from(approvalRequests)
    .where(eq(approvalRequests.id, input.approvalId))
    .limit(1);
  if (!row) {
    throw new Error("Approval request not found");
  }
  if (row.status !== "pending") {
    throw new Error("Approval is not pending");
  }
  if (row.approverAgentId !== input.resolverAgentId) {
    throw new Error("Only the assigned approver can resolve this request");
  }

  const [resolver] = await db.select().from(agents).where(eq(agents.id, input.resolverAgentId)).limit(1);
  if (!resolver) {
    throw new Error("Resolver agent not found");
  }

  const now = new Date();
  const newStatus: ApprovalStatus = input.decision === "approved" ? "approved" : "rejected";

  await db
    .update(approvalRequests)
    .set({
      status: newStatus,
      resolutionNote: input.resolutionNote?.trim() || null,
      resolvedAt: now,
    })
    .where(eq(approvalRequests.id, input.approvalId));

  const messageId = randomUUID();
  const noteLine = input.resolutionNote?.trim() ? `Note: ${input.resolutionNote.trim()}` : "";
  const createdAtResolve = new Date();
  const insertedResolve = {
    id: messageId,
    threadId: row.sourceThreadId,
    agentId: resolver.id,
    actorType: "agent" as const,
    actorName: resolver.name,
    content: [`[Approval ${input.decision}] id=${row.id}`, noteLine].filter((l) => l !== "").join("\n"),
    createdAt: createdAtResolve,
  };
  await db.insert(messages).values(insertedResolve);
  emitThreadMessage(row.sourceThreadId, {
    ...insertedResolve,
    createdAt: createdAtResolve.toISOString(),
  });

  void enqueueThreadOwnerRunOnMessage({
    threadId: row.sourceThreadId,
    messageId,
    actorType: "agent",
    actorAgentId: resolver.id,
  }).catch((err) => {
    console.error("Failed to enqueue thread owner run after approval resolve:", err);
  });

  return { success: true };
}

export async function cancelApprovalRequest(input: {
  approvalId: string;
  requesterAgentId: string;
}): Promise<{ success: boolean }> {
  const [row] = await db
    .select()
    .from(approvalRequests)
    .where(eq(approvalRequests.id, input.approvalId))
    .limit(1);
  if (!row) {
    throw new Error("Approval request not found");
  }
  if (row.requesterAgentId !== input.requesterAgentId) {
    throw new Error("Only the requester can cancel this approval");
  }
  if (row.status !== "pending") {
    throw new Error("Only pending approvals can be cancelled");
  }

  await db
    .update(approvalRequests)
    .set({
      status: "cancelled",
      resolvedAt: new Date(),
    })
    .where(eq(approvalRequests.id, input.approvalId));

  return { success: true };
}
