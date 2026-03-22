/**
 * API client for Pixel backend. Use /api prefix in dev (Vite proxy) or VITE_API_URL.
 */
const BASE =
  typeof import.meta.env.VITE_API_URL === "string" && import.meta.env.VITE_API_URL
    ? import.meta.env.VITE_API_URL
    : "/api";
export const API_BASE = BASE;

async function fetchApi<T>(
  path: string,
  options?: RequestInit & { parse?: "json" }
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || res.statusText || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// --- Types (match backend schema) ---
export interface Agent {
  id: string;
  name: string;
  type: string;
  role: string;
  isLead: boolean;
  parentId: string | null;
  config: string | null;
  awakeEnabled: boolean;
  awakeIntervalMinutes: number;
  lastAwakeAt: string | null;
  nextAwakeAt: string | null;
  configDisplay?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  goals: string | null;
  createdAt: string;
}

export type ThreadStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "blocked"
  | "cancelled";

export interface Thread {
  id: string;
  projectId: string;
  agentId: string;
  title: string | null;
  /** Work item status; omit on older API responses until migrated */
  status?: ThreadStatus;
  createdAt: string;
}

export interface Message {
  id: string;
  threadId: string;
  agentId: string | null;
  actorType: "agent" | "board";
  actorName: string | null;
  content: string;
  createdAt: string;
}

export interface AgentRunRequest {
  id: string;
  projectId: string;
  threadId: string;
  agentId: string;
  reason: string;
  model: string;
  idempotencyKey: string;
  status: "queued" | "running" | "done" | "failed";
  pid: number | null;
  command: string | null;
  args: string | null;
  exitCode: number | null;
  stdout: string | null;
  stderr: string | null;
  timedOut: boolean | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActiveAgentRun extends AgentRunRequest {
  agentName: string;
  agentRole: string | null;
  projectName: string;
  threadTitle: string | null;
}

export interface LinkedProject {
  id: string;
  name: string;
  slug: string;
}

export interface VisibleProject {
  projectId: string;
  artifactsPath: string;
  linkedProject: LinkedProject | null;
}

export interface ProjectAgentWorkspace {
  agentId: string;
  name: string;
  role: string;
  agentDir: string;
  artifactsPath: string;
}

export interface VisibleAgentWork {
  agentId: string;
  name: string;
  role: string;
  agentDir: string;
  projects: VisibleProject[];
}

// --- API ---
export const api = {
  getAgents: () => fetchApi<Agent[]>("/agents"),
  getAgent: (id: string) =>
    fetchApi<Agent>("/agents/" + encodeURIComponent(id)),
  getAgentVisibleWork: (id: string) =>
    fetchApi<VisibleAgentWork[]>("/agents/" + encodeURIComponent(id) + "/visible-work"),
  updateAgent: (
    id: string,
    body: {
      name?: string;
      role?: string;
      config?: string | null;
      awakeEnabled?: boolean;
      awakeIntervalMinutes?: number;
    }
  ) =>
    fetchApi<{ success: boolean }>("/agents/" + encodeURIComponent(id), {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  getProjects: () => fetchApi<Project[]>("/projects"),
  getProject: (id: string) =>
    fetchApi<Project>("/projects/" + encodeURIComponent(id)),
  getProjectAgentWorkspaces: (id: string) =>
    fetchApi<ProjectAgentWorkspace[]>(
      "/projects/" + encodeURIComponent(id) + "/agent-workspaces"
    ),
  createProject: (body: { name: string }) =>
    fetchApi<{ success: boolean; name: string; slug: string }>("/projects", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateProject: (
    id: string,
    body: { name?: string; goals?: string | null }
  ) =>
    fetchApi<{ success: boolean }>("/projects/" + encodeURIComponent(id), {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  getProjectThreads: (projectId: string, params?: { status?: ThreadStatus }) => {
    const q = params?.status ? "?status=" + encodeURIComponent(params.status) : "";
    return fetchApi<Thread[]>("/projects/" + encodeURIComponent(projectId) + "/threads" + q);
  },
  createThread: (
    projectId: string,
    body: { agentId: string; title?: string; status?: ThreadStatus }
  ) =>
    fetchApi<{
      success: boolean;
      id: string;
      projectId: string;
      agentId: string;
      status?: ThreadStatus;
    }>("/projects/" + encodeURIComponent(projectId) + "/threads", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  patchThreadStatusAsBoard: (threadId: string, status: ThreadStatus) =>
    fetchApi<{ success: boolean; status: string; message?: string }>(
      "/threads/" + encodeURIComponent(threadId) + "/status",
      {
        method: "PATCH",
        body: JSON.stringify({ status, actorType: "board" }),
      }
    ),

  getThreadMessages: (threadId: string) =>
    fetchApi<Message[]>("/threads/" + encodeURIComponent(threadId) + "/messages"),
  getThreadRuns: (threadId: string) =>
    fetchApi<AgentRunRequest[]>("/threads/" + encodeURIComponent(threadId) + "/runs"),
  getActiveRuns: () => fetchApi<ActiveAgentRun[]>("/runs/active"),
  triggerAwakeCycle: () =>
    fetchApi<{ success: boolean; dueAgents: number; enqueuedRuns: number }>(
      "/orchestration/awake/run",
      { method: "POST" }
    ),
  postMessage: (
    threadId: string,
    body:
      | { content: string; actorType: "board"; actorName?: string }
      | { content: string; actorType?: "agent"; agentId: string; actorName?: string }
  ) =>
    fetchApi<{ success: boolean; threadId: string; actorType: "agent" | "board"; agentId: string | null }>(
      "/threads/" + encodeURIComponent(threadId) + "/messages",
      { method: "POST", body: JSON.stringify(body) }
    ),
  postBoardMessage: (threadId: string, body: { content: string }) =>
    fetchApi<{ success: boolean; threadId: string; actorType: "board"; agentId: null }>(
      "/threads/" + encodeURIComponent(threadId) + "/messages/board",
      { method: "POST", body: JSON.stringify(body) }
    ),
};
