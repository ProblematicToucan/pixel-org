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

export async function listProjects(): Promise<{ id: string; name: string; slug: string }[]> {
  return get<{ id: string; name: string; slug: string }[]>("/projects");
}

export async function createProject(name: string, slug: string): Promise<{ success: boolean }> {
  return post("/projects", { name, slug });
}

export async function listThreads(projectId: string): Promise<
  { id: string; projectId: string; agentId: string; title: string | null }[]
> {
  return get(`/projects/${encodeURIComponent(projectId)}/threads`);
}

export async function createThread(
  projectId: string,
  title?: string
): Promise<{ success: boolean; projectId: string; agentId: string }> {
  return post(`/projects/${encodeURIComponent(projectId)}/threads`, {
    agentId: agentId(),
    title: title ?? null,
  });
}

export async function listMessages(threadId: string): Promise<
  { id: string; threadId: string; agentId: string; content: string }[]
> {
  return get(`/threads/${encodeURIComponent(threadId)}/messages`);
}

export async function postMessage(threadId: string, content: string): Promise<{ success: boolean }> {
  return post(`/threads/${encodeURIComponent(threadId)}/messages`, {
    agentId: agentId(),
    content,
  });
}
