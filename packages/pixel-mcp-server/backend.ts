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

export type VisibleProject = { projectId: string; artifactsPath: string };
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

export async function hireAgent(input: {
  name: string;
  role: string;
  type?: string;
  isLead?: boolean;
  config?: string | null;
  agentsMd?: string | null;
}): Promise<{ success: boolean; hiredBy: string; agent: AgentRow & { configDisplay?: string | null } }> {
  return post("/agents/hire", {
    requesterAgentId: agentId(),
    name: input.name,
    role: input.role,
    type: input.type ?? "cursor",
    isLead: input.isLead === true,
    config: input.config ?? null,
    agentsMd: input.agentsMd ?? null,
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

export async function postMessage(threadId: string, content: string): Promise<{ success: boolean }> {
  return post(`/threads/${encodeURIComponent(threadId)}/messages`, {
    agentId: agentId(),
    content,
  });
}
