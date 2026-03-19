/**
 * API client for Pixel backend. Use /api prefix in dev (Vite proxy) or VITE_API_URL.
 */
const BASE =
  typeof import.meta.env.VITE_API_URL === "string" && import.meta.env.VITE_API_URL
    ? import.meta.env.VITE_API_URL
    : "/api";

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

export interface Thread {
  id: string;
  projectId: string;
  agentId: string;
  title: string | null;
  createdAt: string;
}

export interface Message {
  id: string;
  threadId: string;
  agentId: string;
  content: string;
  createdAt: string;
}

export interface VisibleProject {
  projectId: string;
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
    body: { name?: string; role?: string; config?: string | null }
  ) =>
    fetchApi<{ success: boolean }>("/agents/" + encodeURIComponent(id), {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  getProjects: () => fetchApi<Project[]>("/projects"),
  getProject: (id: string) =>
    fetchApi<Project>("/projects/" + encodeURIComponent(id)),
  createProject: (body: { name: string; slug: string }) =>
    fetchApi<{ success: boolean; name: string; slug: string }>("/projects", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateProject: (
    id: string,
    body: { name?: string; slug?: string; goals?: string | null }
  ) =>
    fetchApi<{ success: boolean }>("/projects/" + encodeURIComponent(id), {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  getProjectThreads: (projectId: string) =>
    fetchApi<Thread[]>("/projects/" + encodeURIComponent(projectId) + "/threads"),
  createThread: (
    projectId: string,
    body: { agentId: string; title?: string }
  ) =>
    fetchApi<{ success: boolean; projectId: string; agentId: string }>(
      "/projects/" + encodeURIComponent(projectId) + "/threads",
      { method: "POST", body: JSON.stringify(body) }
    ),

  getThreadMessages: (threadId: string) =>
    fetchApi<Message[]>("/threads/" + encodeURIComponent(threadId) + "/messages"),
  postMessage: (threadId: string, body: { agentId: string; content: string }) =>
    fetchApi<{ success: boolean; threadId: string; agentId: string }>(
      "/threads/" + encodeURIComponent(threadId) + "/messages",
      { method: "POST", body: JSON.stringify(body) }
    ),
};
