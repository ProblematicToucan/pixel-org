import { eq } from "drizzle-orm";
import { agents, threads } from "../db/schema.js";
import { canAssignThreadOwner, resolveActorRelation } from "./visible-work.js";

type Db = typeof import("../db/index.js").db;

export type PolicyDecision =
  | { allowed: true }
  | { allowed: false; code: "denied" | "must_delegate" | "requires_approval"; reason: string };

const ALLOWED_TASK_TYPES = ["technical", "operations", "finance", "strategy", "general"] as const;
export type ThreadTaskType = typeof ALLOWED_TASK_TYPES[number];

export function normalizeThreadTaskType(value: unknown): ThreadTaskType {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if ((ALLOWED_TASK_TYPES as readonly string[]).includes(normalized)) {
    return normalized as ThreadTaskType;
  }
  return "general";
}

function normalizeTitle(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export async function evaluateThreadCreation(
  db: Db,
  params: {
    requesterAgentId: string;
    ownerAgentId: string;
    taskType: ThreadTaskType;
    title: string | null;
  }
): Promise<PolicyDecision> {
  const [requester] = await db.select().from(agents).where(eq(agents.id, params.requesterAgentId)).limit(1);
  if (!requester) {
    return { allowed: false, code: "denied", reason: "requesterAgentId not found" };
  }

  const allowedByHierarchy = await canAssignThreadOwner(db, params.requesterAgentId, params.ownerAgentId);
  if (!allowedByHierarchy) {
    return {
      allowed: false,
      code: "denied",
      reason: "Not allowed to assign this owner: must be self, or (as a lead) assign to an agent in your reporting line",
    };
  }

  const isBoardKickoff = normalizeTitle(params.title) === "board kickoff";
  const isSelfOwnedByLead = requester.isLead === true && params.requesterAgentId === params.ownerAgentId;
  if (isSelfOwnedByLead && params.taskType !== "strategy" && !isBoardKickoff) {
    return {
      allowed: false,
      code: "must_delegate",
      reason: "Lead agents must delegate operational threads to reports (self-owned threads are strategy-only)",
    };
  }

  return { allowed: true };
}

export async function evaluateMessagePosting(
  db: Db,
  params: {
    actorType: "agent" | "board";
    actorAgentId: string | null;
    threadId: string;
    hasRunStatus: boolean;
  }
): Promise<PolicyDecision> {
  if (params.actorType === "board") return { allowed: true };
  const actorId = (params.actorAgentId ?? "").trim();
  if (!actorId) {
    return { allowed: false, code: "denied", reason: "agentId is required when actorType is agent" };
  }

  const [thread] = await db.select().from(threads).where(eq(threads.id, params.threadId)).limit(1);
  if (!thread) {
    return { allowed: false, code: "denied", reason: "Thread not found" };
  }

  const relation = await resolveActorRelation(db, actorId, thread.agentId);
  if (relation === "self") return { allowed: true };
  if (relation === "descendant") {
    if (params.hasRunStatus) {
      return {
        allowed: false,
        code: "denied",
        reason: "Managers may review report threads but cannot post execution run status updates",
      };
    }
    return { allowed: true };
  }

  return {
    allowed: false,
    code: "denied",
    reason: "Only thread owner, owner's management chain, or Board of Directors may post in this thread",
  };
}

export async function evaluateThreadStatusChange(
  db: Db,
  params: {
    actorType: "agent" | "board";
    requesterAgentId: string | null;
    threadId: string;
    newStatus: "not_started" | "in_progress" | "completed" | "blocked" | "cancelled";
  }
): Promise<PolicyDecision> {
  if (params.actorType === "board") return { allowed: true };
  const requesterId = (params.requesterAgentId ?? "").trim();
  if (!requesterId) {
    return { allowed: false, code: "denied", reason: "requesterAgentId is required when actorType is not 'board'" };
  }

  const [thread] = await db.select().from(threads).where(eq(threads.id, params.threadId)).limit(1);
  if (!thread) {
    return { allowed: false, code: "denied", reason: "Thread not found" };
  }
  if (requesterId === thread.agentId) return { allowed: true };

  const relation = await resolveActorRelation(db, requesterId, thread.agentId);
  if (relation === "descendant" && (params.newStatus === "blocked" || params.newStatus === "cancelled")) {
    return { allowed: true };
  }

  return {
    allowed: false,
    code: "denied",
    reason: "Only thread owner, owner's management chain (blocked/cancelled), or Board of Directors can change thread status",
  };
}
