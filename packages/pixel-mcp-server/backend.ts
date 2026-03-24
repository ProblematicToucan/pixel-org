/**
 * HTTP client for the Pixel backend. Reads PIXEL_BACKEND_URL and PIXEL_AGENT_ID from env.
 */

const BASE_URL = (process.env.PIXEL_BACKEND_URL || "http://localhost:3000").replace(/\/$/, "");
const AGENT_ID = process.env.PIXEL_AGENT_ID || "";

function agentId(): string {
  if (!AGENT_ID) {
    throw new Error("PIXEL_AGENT_ID is not set");
  }
  return AGENT_ID;
}

/** Current agent UUID from env (same as used for backend calls). */
export function getCurrentAgentId(): string {
  return agentId();
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Backend ${res.status}: ${text || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Backend ${res.status}: ${text || res.statusText}`);
  }
  if (res.status === 201 || res.status === 200) {
    try {
      return (await res.json()) as T;
    } catch {
      return {} as T;
    }
  }
  return {} as T;
}

async function patch<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Backend ${res.status}: ${text || res.statusText}`);
  }
  if (res.status === 200) {
    try {
      return (await res.json()) as T;
    } catch {
      return {} as T;
    }
  }
  return {} as T;
}

export type LinkedProject = { id: string; name: string; slug: string };
export type VisibleProject = {
  projectId: string;
  projectPath: string;
  linkedProject: LinkedProject | null;
};
export type VisibleAgentWork = {
  agentId: string;
  name: string;
  role: string;
  agentDir: string;
  projects: VisibleProject[];
};

export async function getVisibleWork(): Promise<VisibleAgentWork[]> {
  return get<VisibleAgentWork[]>(`/agents/${encodeURIComponent(agentId())}/visible-work`);
}

export type AgentRow = {
  id: string;
  name: string;
  type: string;
  role: string;
  isLead: boolean | number;
  parentId: string | null;
  config: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function getAgent(id: string): Promise<AgentRow> {
  return get<AgentRow>(`/agents/${encodeURIComponent(id)}`);
}

/** All organization agents (roster), same order as the web app: lead first, then by name. */
export async function listAgents(): Promise<(AgentRow & { configDisplay?: string | null })[]> {
  return get<(AgentRow & { configDisplay?: string | null })[]>("/agents");
}

export async function hireAgent(input: {
  name: string;
  role: string;
  type?: string;
  config?: string | null;
  agentsMd?: string | null;
  /** Optional: same key + same hiring parent returns the existing hire (safe retries). */
  idempotencyKey?: string | null;
}): Promise<{
  success: boolean;
  hiredBy: string;
  idempotentReplay?: boolean;
  agent: AgentRow & { configDisplay?: string | null };
}> {
  return post("/agents/hire", {
    requesterAgentId: agentId(),
    name: input.name,
    role: input.role,
    type: input.type ?? "cursor",
    config: input.config ?? null,
    agentsMd: input.agentsMd ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
  });
}

export type Project = { id: string; name: string; slug: string; goals?: string | null };

export async function listProjects(): Promise<Project[]> {
  return get<Project[]>("/projects");
}

export async function getProject(projectId: string): Promise<Project> {
  return get<Project>(`/projects/${encodeURIComponent(projectId)}`);
}

export async function updateProjectGoals(projectId: string, goals: string | null): Promise<{ success: boolean }> {
  return patch<{ success: boolean }>(`/projects/${encodeURIComponent(projectId)}`, {
    goals: goals ?? null,
  });
}

export async function createProject(name: string): Promise<{ success: boolean; slug?: string }> {
  return post("/projects", { name });
}

export async function listThreads(
  projectId: string,
  options?: { status?: "not_started" | "in_progress" | "completed" | "blocked" | "cancelled" | null }
): Promise<
  { id: string; projectId: string; agentId: string; title: string | null; status: string }[]
> {
  const url = options?.status
    ? `/projects/${encodeURIComponent(projectId)}/threads?status=${encodeURIComponent(options.status)}`
    : `/projects/${encodeURIComponent(projectId)}/threads`;
  return get(url);
}

export async function createThread(
  projectId: string,
  title?: string,
  options?: {
    ownerAgentId?: string | null;
    status?: "not_started" | "in_progress" | "completed" | "blocked" | "cancelled" | null;
  }
): Promise<{ success: boolean; id?: string; projectId: string; agentId: string; status?: string }> {
  const requester = agentId();
  const owner = options?.ownerAgentId?.trim() || requester;
  return post(`/projects/${encodeURIComponent(projectId)}/threads`, {
    agentId: owner,
    title: title ?? null,
    status: options?.status ?? null,
    /** When set, backend enforces: self, or lead assigning to an agent in their reporting line. */
    requesterAgentId: requester,
  });
}

export async function setThreadStatus(
  threadId: string,
  status: "not_started" | "in_progress" | "completed" | "blocked" | "cancelled"
): Promise<{ success: boolean; status: string }> {
  return patch(`/threads/${encodeURIComponent(threadId)}/status`, {
    status,
    requesterAgentId: agentId(),
    actorType: "agent",
  });
}

export async function listMessages(threadId: string): Promise<
  {
    id: string;
    threadId: string;
    agentId: string | null;
    actorType: "agent" | "board";
    actorName: string | null;
    content: string;
    createdAt: string;
  }[]
> {
  return get(`/threads/${encodeURIComponent(threadId)}/messages`);
}

export async function postMessage(
  threadId: string,
  content: string,
  options?: {
    runId?: string | null;
    runStatus?: "started" | "in_progress" | "completed" | null;
  }
): Promise<{ success: boolean }> {
  const body: Record<string, unknown> = {
    agentId: agentId(),
    content,
  };
  const rid = options?.runId;
  if (rid != null && String(rid).trim() !== "") {
    body.runId = rid;
  }
  if (options?.runStatus != null) {
    body.runStatus = options.runStatus;
  }
  return post(`/threads/${encodeURIComponent(threadId)}/messages`, body);
}

export type ApprovalRequestRow = {
  id: string;
  projectId: string;
  sourceThreadId: string;
  requesterAgentId: string;
  approverAgentId: string;
  summary: string;
  status: string;
  resolutionNote: string | null;
  metadata: string | null;
  idempotencyKey: string;
  createdAt: string;
  resolvedAt: string | null;
};

/** Thread owner requests approval from their direct manager (parent). Enqueues approver run. */
export async function createApprovalRequest(input: {
  projectId: string;
  sourceThreadId: string;
  summary: string;
  approverAgentId?: string | null;
  metadata?: string | null;
  idempotencyKey?: string | null;
}): Promise<{ success: boolean; created: boolean; approval: ApprovalRequestRow }> {
  return post("/approval-requests", {
    requesterAgentId: agentId(),
    projectId: input.projectId,
    sourceThreadId: input.sourceThreadId,
    summary: input.summary,
    approverAgentId: input.approverAgentId ?? null,
    metadata: input.metadata ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
  });
}

/** List approvals where the current agent is approver or requester. */
export async function listApprovalRequests(options: {
  as: "approver" | "requester";
  status?: "pending" | "approved" | "rejected" | "cancelled";
}): Promise<ApprovalRequestRow[]> {
  const q = new URLSearchParams({ as: options.as });
  if (options.status) {
    q.set("status", options.status);
  }
  return get<ApprovalRequestRow[]>(
    `/agents/${encodeURIComponent(agentId())}/approval-requests?${q.toString()}`
  );
}

/** Approver resolves a pending approval (must be the assigned approver). */
export async function resolveApprovalRequest(input: {
  approvalRequestId: string;
  decision: "approved" | "rejected";
  resolutionNote: string;
}): Promise<{ success: boolean }> {
  return patch(`/approval-requests/${encodeURIComponent(input.approvalRequestId)}/resolve`, {
    resolverAgentId: agentId(),
    decision: input.decision,
    resolutionNote: input.resolutionNote.trim(),
  });
}

/** Requester cancels a pending approval. */
export async function cancelApprovalRequest(approvalRequestId: string): Promise<{ success: boolean }> {
  return patch(`/approval-requests/${encodeURIComponent(approvalRequestId)}/cancel`, {
    requesterAgentId: agentId(),
  });
}
