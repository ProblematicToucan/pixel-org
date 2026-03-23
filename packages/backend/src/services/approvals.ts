import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db, agents, approvalRequests, threads, messages } from "../db/index.js";
import {
  cancelApprovalRunsForRequest,
  enqueueApprovalPendingRun,
  enqueueThreadOwnerRunOnMessage,
} from "./orchestration.js";
import { emitThreadMessage } from "../threadMessageSse.js";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";

async function ensureApprovalSideEffects(
  approval: typeof approvalRequests.$inferSelect
): Promise<void> {
  const [requester] = await db.select().from(agents).where(eq(agents.id, approval.requesterAgentId)).limit(1);
  const [approver] = await db.select().from(agents).where(eq(agents.id, approval.approverAgentId)).limit(1);
  if (!requester || !approver) {
    return;
  }

  const prefix = `[Approval requested] id=${approval.id}`;
  const auditMessageId = `approval-requested:${approval.id}`;
  const createdAtCreate = new Date();
  const insertedCreate = {
    id: auditMessageId,
    threadId: approval.sourceThreadId,
    agentId: approval.requesterAgentId,
    actorType: "agent" as const,
    actorName: requester.name,
    content: [
      prefix,
      `Summary: ${approval.summary}`,
      `Approver: ${approver.name} (${approval.approverAgentId})`,
    ].join("\n"),
    createdAt: createdAtCreate,
  };

  const insertedAudit = await db
    .insert(messages)
    .values(insertedCreate)
    .onConflictDoNothing({ target: messages.id })
    .returning();

  if (insertedAudit.length > 0) {
    emitThreadMessage(approval.sourceThreadId, {
      ...insertedCreate,
      createdAt: createdAtCreate.toISOString(),
    });
  }

  await enqueueApprovalPendingRun({
    projectId: approval.projectId,
    sourceThreadId: approval.sourceThreadId,
    approverAgentId: approval.approverAgentId,
    approvalRequestId: approval.id,
  });
}

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
  const insertedRows = await db
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
    .onConflictDoNothing({
      target: [approvalRequests.requesterAgentId, approvalRequests.sourceThreadId, approvalRequests.idempotencyKey],
    })
    .returning();

  let approval: typeof approvalRequests.$inferSelect;
  let created: boolean;

  if (insertedRows.length > 0) {
    approval = insertedRows[0]!;
    created = true;
  } else {
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
    if (!existing) {
      throw new Error("Failed to create or load approval request");
    }
    approval = existing;
    created = false;
  }

  await ensureApprovalSideEffects(approval);

  return { created, approval };
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
  resolutionNote: string;
}): Promise<{ success: boolean }> {
  const note = input.resolutionNote.trim();
  if (!note) {
    throw new Error("resolutionNote is required");
  }

  const [resolver] = await db.select().from(agents).where(eq(agents.id, input.resolverAgentId)).limit(1);
  if (!resolver) {
    throw new Error("Resolver agent not found");
  }

  const now = new Date();
  const newStatus: ApprovalStatus = input.decision === "approved" ? "approved" : "rejected";

  const updatedRows = await db
    .update(approvalRequests)
    .set({
      status: newStatus,
      resolutionNote: note,
      resolvedAt: now,
    })
    .where(
      and(
        eq(approvalRequests.id, input.approvalId),
        eq(approvalRequests.status, "pending"),
        eq(approvalRequests.approverAgentId, input.resolverAgentId)
      )
    )
    .returning();

  if (updatedRows.length === 0) {
    throw new Error("Approval already resolved or not authorized");
  }

  const row = updatedRows[0]!;

  const messageId = randomUUID();
  const noteLine = `Note: ${note}`;
  const createdAtResolve = new Date();
  const insertedResolve = {
    id: messageId,
    threadId: row.sourceThreadId,
    agentId: resolver.id,
    actorType: "agent" as const,
    actorName: resolver.name,
    content: [`[Approval ${input.decision}] id=${row.id}`, noteLine].join("\n"),
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
  const updatedRows = await db
    .update(approvalRequests)
    .set({
      status: "cancelled",
      resolvedAt: new Date(),
    })
    .where(
      and(
        eq(approvalRequests.id, input.approvalId),
        eq(approvalRequests.status, "pending"),
        eq(approvalRequests.requesterAgentId, input.requesterAgentId)
      )
    )
    .returning();

  if (updatedRows.length === 0) {
    throw new Error("Approval already resolved or not authorized to cancel");
  }

  const row = updatedRows[0]!;
  await cancelApprovalRunsForRequest(row.id);

  const [requesterForCancel] = await db
    .select()
    .from(agents)
    .where(eq(agents.id, row.requesterAgentId))
    .limit(1);
  const cancelMessageId = `approval-cancelled:${row.id}`;
  const createdAtCancel = new Date();
  const insertedCancel = {
    id: cancelMessageId,
    threadId: row.sourceThreadId,
    agentId: row.requesterAgentId,
    actorType: "agent" as const,
    actorName: requesterForCancel?.name ?? "Agent",
    content: [`[Approval cancelled] id=${row.id}`, `Status: cancelled`, `Resolved at: ${createdAtCancel.toISOString()}`].join(
      "\n"
    ),
    createdAt: createdAtCancel,
  };

  const insertedCancelRows = await db
    .insert(messages)
    .values(insertedCancel)
    .onConflictDoNothing({ target: messages.id })
    .returning();

  if (insertedCancelRows.length > 0) {
    emitThreadMessage(row.sourceThreadId, {
      ...insertedCancel,
      createdAt: createdAtCancel.toISOString(),
    });
  }

  return { success: true };
}
