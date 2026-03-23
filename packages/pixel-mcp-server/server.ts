import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { buildAgentContextBlock } from "./agent-context.js";
import * as backend from "./backend.js";
import { addMemory, isMemoryConfigured, mem0UserId, type StoreMemoryCategory } from "./memory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** When false, `pixel_cancel_approval_request` is not registered (set PIXEL_ENABLE_CANCEL_APPROVAL=false to disable). */
const PIXEL_CANCEL_APPROVAL_ENABLED =
  process.env.PIXEL_ENABLE_CANCEL_APPROVAL !== "false" &&
  process.env.PIXEL_ENABLE_CANCEL_APPROVAL !== "0";

function getDistDir(): string {
  return __dirname.endsWith("dist") ? __dirname : path.join(__dirname, "dist");
}

/**
 * Creates the Pixel MCP server: backend tools + Pixel Context MCP App (tool + resource).
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "Pixel MCP Server",
    version: "1.0.0",
  });

  // --- Backend tools (no UI) ---

  server.registerTool(
    "pixel_get_visible_work",
    {
      description:
        "Get work this agent can see: self + all reports (artifact paths). Use when you are a lead reviewing reports' work.",
      inputSchema: {},
    },
    async (): Promise<CallToolResult> => {
      try {
        const work = await backend.getVisibleWork();
        const text = JSON.stringify(work, null, 2);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "pixel_hire_agent",
    {
      description:
        "Lead-only: hire a new child agent under the current lead agent (current PIXEL_AGENT_ID).",
      inputSchema: z.object({
        name: z.string().describe("New agent display name"),
        role: z.string().describe("New agent role (e.g. Engineer, Researcher)"),
        type: z.string().optional().describe("Agent type/provider label (default: cursor)"),
        config: z.string().nullable().optional().describe("Optional instruction/config text for AGENTS.md"),
        agentsMd: z
          .string()
          .nullable()
          .optional()
          .describe("Optional full AGENTS.md content. If provided, replaces the default generated template."),
        idempotencyKey: z
          .string()
          .nullable()
          .optional()
          .describe(
            "Optional stable key for this hire intent (e.g. UUID). Reusing the same key returns the existing agent instead of creating a duplicate."
          ),
      }),
    },
    async (args: {
      name?: string;
      role?: string;
      type?: string;
      config?: string | null;
      agentsMd?: string | null;
      idempotencyKey?: string | null;
    }): Promise<CallToolResult> => {
      const name = args?.name ?? "";
      const role = args?.role ?? "";
      if (!name.trim() || !role.trim()) {
        return {
          content: [{ type: "text", text: "Error: name and role are required" }],
          isError: true,
        };
      }
      try {
        const result = await backend.hireAgent({
          name: name.trim(),
          role: role.trim(),
          type: args?.type?.trim() || "cursor",
          config: args?.config ?? null,
          agentsMd: args?.agentsMd ?? null,
          idempotencyKey: args?.idempotencyKey?.trim() || null,
        });
        const replay =
          result.idempotentReplay === true
            ? " (idempotent replay — this key was already used for a hire)"
            : "";
        return {
          content: [
            {
              type: "text",
              text: `Hired agent "${result.agent.name}" (${result.agent.role}) with id ${result.agent.id}.${replay}`,
            },
          ],
          structuredContent: result,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "pixel_list_agents",
    {
      description:
        "List all agents in the organization (id, name, role, lead flag, parent id, config display). Use for the company roster: who works here, roles, reporting lines, and agent ids for coordination or threads — not only for hiring.",
      inputSchema: {},
    },
    async (): Promise<CallToolResult> => {
      try {
        const list = await backend.listAgents();
        const text = JSON.stringify(list, null, 2);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "pixel_list_projects",
    {
      description: "List all projects (channels).",
      inputSchema: {},
    },
    async (): Promise<CallToolResult> => {
      try {
        const list = await backend.listProjects();
        const text = JSON.stringify(list, null, 2);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "pixel_create_project",
    {
      description: "Create a new project. Requires name; slug is auto-generated and read-only.",
      inputSchema: z.object({
        name: z.string().describe("Project display name"),
      }),
    },
    async (args: { name?: string }): Promise<CallToolResult> => {
      const name = args?.name ?? "";
      if (!name) {
        return {
          content: [{ type: "text", text: "Error: name is required" }],
          isError: true,
        };
      }
      try {
        const result = await backend.createProject(name);
        const createdSlug = result.slug || "(auto-generated)";
        return { content: [{ type: "text", text: `Created project "${name}" (${createdSlug})` }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "pixel_get_project_goals",
    {
      description:
        "Get the goals for a project (user-defined objectives). Use to read what the user wants for this project.",
      inputSchema: z.object({
        projectId: z.string().describe("Project UUID"),
      }),
    },
    async (args: { projectId?: string }): Promise<CallToolResult> => {
      const projectId = args?.projectId ?? "";
      if (!projectId) {
        return {
          content: [{ type: "text", text: "Error: projectId is required" }],
          isError: true,
        };
      }
      try {
        const project = await backend.getProject(projectId);
        const text = project.goals ?? "(no goals set)";
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "pixel_set_project_goals",
    {
      description:
        "Set or update the goals for a project (user-defined objectives). Use when the user or you define project goals.",
      inputSchema: z.object({
        projectId: z.string().describe("Project UUID"),
        goals: z.string().describe("Goals text (objectives for this project)"),
      }),
    },
    async (args: { projectId?: string; goals?: string }): Promise<CallToolResult> => {
      const projectId = args?.projectId ?? "";
      const goals = args?.goals ?? "";
      if (!projectId) {
        return {
          content: [{ type: "text", text: "Error: projectId is required" }],
          isError: true,
        };
      }
      try {
        await backend.updateProjectGoals(projectId, goals.trim() || null);
        return { content: [{ type: "text", text: "Project goals updated." }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "pixel_list_threads",
    {
      description: "List threads in a project. Optional status filter: not_started, in_progress, completed, blocked, cancelled.",
      inputSchema: z.object({
        projectId: z.string().describe("Project UUID"),
        status: z
          .enum(["not_started", "in_progress", "completed", "blocked", "cancelled"])
          .optional()
          .describe("Optional status filter"),
      }),
    },
    async (args: { projectId?: string; status?: string }): Promise<CallToolResult> => {
      const projectId = args?.projectId ?? "";
      if (!projectId) {
        return {
          content: [{ type: "text", text: "Error: projectId is required" }],
          isError: true,
        };
      }
      try {
        const list = await backend.listThreads(projectId, {
          status: args?.status as "not_started" | "in_progress" | "completed" | "blocked" | "cancelled" | null | undefined,
        });
        const text = JSON.stringify(list, null, 2);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "pixel_create_thread",
    {
      description:
        "Create a thread in a project (e.g. start work on a task). Default owner is the current agent (PIXEL_AGENT_ID). Optional ownerAgentId assigns another agent as thread owner: allowed for self, or for leads assigning to an agent in their reporting line (descendants). Optional status sets initial status (default: not_started).",
      inputSchema: z.object({
        projectId: z.string().describe("Project UUID"),
        title: z.string().optional().describe("Optional thread title"),
        ownerAgentId: z
          .string()
          .optional()
          .describe(
            "Optional thread owner (assignee). Omit to own the thread yourself. Leads may set this to a report's agent id."
          ),
        status: z
          .enum(["not_started", "in_progress", "completed", "blocked", "cancelled"])
          .optional()
          .describe("Optional initial thread status (default: not_started)"),
      }),
    },
    async (args: {
      projectId?: string;
      title?: string;
      ownerAgentId?: string;
      status?: string;
    }): Promise<CallToolResult> => {
      const projectId = args?.projectId ?? "";
      if (!projectId) {
        return {
          content: [{ type: "text", text: "Error: projectId is required" }],
          isError: true,
        };
      }
      try {
        const result = await backend.createThread(projectId, args?.title, {
          ownerAgentId: args?.ownerAgentId,
          status: args?.status as
            | "not_started"
            | "in_progress"
            | "completed"
            | "blocked"
            | "cancelled"
            | null
            | undefined,
        });
        const idPart = result.id ? ` id=${result.id}` : "";
        const ownerPart =
          result.agentId && result.agentId !== backend.getCurrentAgentId()
            ? ` owner=${result.agentId}`
            : "";
        const statusPart = result.status ? ` status=${result.status}` : "";
        return {
          content: [
            {
              type: "text",
              text: `Created thread in project ${projectId}${idPart}${ownerPart}${statusPart}${args?.title ? ` title="${args.title}"` : ""}`,
            },
          ],
          structuredContent: result,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "pixel_set_thread_status",
    {
      description:
        "Set thread status (not_started, in_progress, completed, blocked, cancelled). Only thread owner or Board of Directors can change status. Posts an informational message when status changes.",
      inputSchema: z.object({
        threadId: z.string().describe("Thread UUID"),
        status: z
          .enum(["not_started", "in_progress", "completed", "blocked", "cancelled"])
          .describe("New thread status"),
      }),
    },
    async (args: { threadId?: string; status?: string }): Promise<CallToolResult> => {
      const threadId = args?.threadId ?? "";
      const status = args?.status as "not_started" | "in_progress" | "completed" | "blocked" | "cancelled" | undefined;
      if (!threadId) {
        return {
          content: [{ type: "text", text: "Error: threadId is required" }],
          isError: true,
        };
      }
      if (!status) {
        return {
          content: [{ type: "text", text: "Error: status is required" }],
          isError: true,
        };
      }
      try {
        const result = await backend.setThreadStatus(threadId, status);
        return {
          content: [
            {
              type: "text",
              text: `Thread ${threadId} status set to ${result.status}. An informational message was posted.`,
            },
          ],
          structuredContent: result,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "pixel_list_messages",
    {
      description: "List messages in a thread (tickets, comments, discussion).",
      inputSchema: z.object({
        threadId: z.string().describe("Thread UUID"),
      }),
    },
    async (args: { threadId?: string }): Promise<CallToolResult> => {
      const threadId = args?.threadId ?? "";
      if (!threadId) {
        return {
          content: [{ type: "text", text: "Error: threadId is required" }],
          isError: true,
        };
      }
      try {
        const list = await backend.listMessages(threadId);
        const text = JSON.stringify(list, null, 2);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "pixel_post_message",
    {
      description: "Post a message to a thread (record progress, reply, or feedback).",
      inputSchema: z.object({
        threadId: z.string().describe("Thread UUID"),
        content: z.string().describe("Message content"),
      }),
    },
    async (args: { threadId?: string; content?: string }): Promise<CallToolResult> => {
      const threadId = args?.threadId ?? "";
      const content = args?.content ?? "";
      if (!threadId || content === undefined) {
        return {
          content: [{ type: "text", text: "Error: threadId and content are required" }],
          isError: true,
        };
      }
      try {
        await backend.postMessage(threadId, String(content));
        return { content: [{ type: "text", text: "Message posted." }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "pixel_create_approval_request",
    {
      description:
        "Request approval from your direct manager (parent agent) on a thread you own. Requires thread in_progress; enqueues the approver to run. Use for high-risk work before execution.",
      inputSchema: z.object({
        projectId: z.string().describe("Project UUID"),
        sourceThreadId: z.string().describe("Thread UUID (you must be the thread owner)"),
        summary: z.string().describe("What you want approved (one short paragraph)"),
        approverAgentId: z
          .string()
          .optional()
          .describe("Optional; defaults to your parent_id (direct manager)"),
        metadata: z.string().optional().describe("Optional JSON string for extra context"),
        idempotencyKey: z.string().optional().describe("Optional dedupe key for retries"),
      }),
    },
    async (args: {
      projectId?: string;
      sourceThreadId?: string;
      summary?: string;
      approverAgentId?: string;
      metadata?: string;
      idempotencyKey?: string;
    }): Promise<CallToolResult> => {
      const projectId = args?.projectId ?? "";
      const sourceThreadId = args?.sourceThreadId ?? "";
      const summary = args?.summary ?? "";
      if (!projectId || !sourceThreadId || !summary.trim()) {
        return {
          content: [{ type: "text", text: "Error: projectId, sourceThreadId, and summary are required" }],
          isError: true,
        };
      }
      try {
        const result = await backend.createApprovalRequest({
          projectId,
          sourceThreadId,
          summary: summary.trim(),
          approverAgentId: args?.approverAgentId?.trim() || null,
          metadata: args?.metadata ?? null,
          idempotencyKey: args?.idempotencyKey ?? null,
        });
        const text = JSON.stringify(result, null, 2);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "pixel_list_approval_requests",
    {
      description:
        "List approval requests for the current agent: as approver (inbox) or as requester. Filter by status (e.g. pending).",
      inputSchema: z.object({
        as: z
          .enum(["approver", "requester"])
          .describe("approver = your inbox; requester = requests you created"),
        status: z
          .enum(["pending", "approved", "rejected", "cancelled"])
          .optional()
          .describe("Optional status filter"),
      }),
    },
    async (args: { as?: string; status?: string }): Promise<CallToolResult> => {
      const as = args?.as === "requester" ? "requester" : "approver";
      try {
        const list = await backend.listApprovalRequests({
          as,
          status: args?.status as "pending" | "approved" | "rejected" | "cancelled" | undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(list, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "pixel_resolve_approval_request",
    {
      description:
        "Approve or reject a pending approval request. Only the assigned approver may call this. Posts an audit line on the source thread and notifies the requester.",
      inputSchema: z.object({
        approvalRequestId: z.string().describe("Approval request UUID"),
        decision: z.enum(["approved", "rejected"]),
        resolutionNote: z.string().trim().min(1).describe("Short rationale (required for audit)"),
      }),
    },
    async (args: {
      approvalRequestId?: string;
      decision?: "approved" | "rejected";
      resolutionNote?: string;
    }): Promise<CallToolResult> => {
      const id = args?.approvalRequestId ?? "";
      const decision = args?.decision;
      const resolutionNote = args?.resolutionNote?.trim() ?? "";
      if (!id || !decision || !resolutionNote) {
        return {
          content: [
            {
              type: "text",
              text: "Error: approvalRequestId, decision, and non-empty resolutionNote are required",
            },
          ],
          isError: true,
        };
      }
      try {
        const result = await backend.resolveApprovalRequest({
          approvalRequestId: id,
          decision,
          resolutionNote,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  if (PIXEL_CANCEL_APPROVAL_ENABLED) {
    server.registerTool(
      "pixel_cancel_approval_request",
      {
        description: "Cancel a pending approval request (requester only).",
        inputSchema: z.object({
          approvalRequestId: z.string().describe("Approval request UUID"),
        }),
      },
      async (args: { approvalRequestId?: string }): Promise<CallToolResult> => {
        const id = args?.approvalRequestId ?? "";
        if (!id) {
          return { content: [{ type: "text", text: "Error: approvalRequestId is required" }], isError: true };
        }
        try {
          const result = await backend.cancelApprovalRequest(id);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
        }
      }
    );
  }

  server.registerTool(
    "pixel_get_context",
    {
      description:
        "Build a single context block for this run: agent info from the backend, optional project goals, optional visible-work paths, and Mem0 OSS semantic memory (if OPENAI_API_KEY is set). Call at the start of a task so you keep the main goals and long-term facts.",
      inputSchema: z.object({
        projectId: z
          .string()
          .optional()
          .describe("Optional project UUID — scopes Mem0 memory and loads that project's goals"),
        query: z
          .string()
          .optional()
          .describe("Optional natural-language query for semantic memory search (Mem0)"),
        includeVisibleWork: z
          .boolean()
          .optional()
          .describe("If true, include JSON of visible artifact paths (can be large; for leads)"),
      }),
    },
    async (args: {
      projectId?: string;
      query?: string;
      includeVisibleWork?: boolean;
    }): Promise<CallToolResult> => {
      try {
        const text = await buildAgentContextBlock({
          projectId: args?.projectId,
          query: args?.query,
          includeVisibleWork: args?.includeVisibleWork === true,
        });
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  const storeCategorySchema = z.enum(["decision", "insight", "preference", "fact", "other"]);

  server.registerTool(
    "pixel_store_memory",
    {
      description:
        "Store a distilled long-term memory in Mem0 OSS (decisions, insights, preferences, important facts). Do not dump full chats — one concise fact per call. Requires OPENAI_API_KEY. Scoped by agent and optional projectId.",
      inputSchema: z.object({
        content: z.string().describe("Concise memory to retain (one idea per call)"),
        projectId: z
          .string()
          .optional()
          .describe("Optional project UUID — memory is scoped to this project"),
        category: storeCategorySchema
          .optional()
          .describe("Type of memory (default: other)"),
      }),
    },
    async (args: {
      content?: string;
      projectId?: string;
      category?: StoreMemoryCategory;
    }): Promise<CallToolResult> => {
      if (!isMemoryConfigured()) {
        return {
          content: [
            {
              type: "text",
              text: "Error: OPENAI_API_KEY is not set on the MCP server. Mem0 OSS needs it for embedder and LLM; semantic memory storage is disabled.",
            },
          ],
          isError: true,
        };
      }
      const content = args?.content ?? "";
      if (!content.trim()) {
        return {
          content: [{ type: "text", text: "Error: content is required" }],
          isError: true,
        };
      }
      try {
        const agentId = backend.getCurrentAgentId();
        const userId = mem0UserId(agentId, args?.projectId?.trim());
        await addMemory({
          userId,
          content: content.trim(),
          category: args?.category,
        });
        return {
          content: [
            {
              type: "text",
              text: `Stored memory for user_id=${userId}${args?.category ? ` (${args.category})` : ""}.`,
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  // --- MCP App: Pixel Context (tool + resource) ---

  const resourceUri = "ui://pixel/context/mcp-app.html";

  registerAppTool(
    server,
    "pixel_show_context",
    {
      title: "Pixel Context",
      description:
        "Show projects, threads, and messages for the current agent. Opens an interactive view. Use to see user requests, tickets, and discussion.",
      inputSchema: z.object({}),
      _meta: { ui: { resourceUri } },
    },
    async (): Promise<CallToolResult> => {
      try {
        const projects = await backend.listProjects();
        const projectsWithThreads: {
          id: string;
          name: string;
          slug: string;
          goals?: string | null;
          threads?: {
            id: string;
            agentId: string;
            title: string | null;
            messages: {
              id: string;
              agentId: string | null;
              actorType: "agent" | "board";
              actorName: string | null;
              content: string;
              createdAt: string;
            }[];
          }[];
        }[] = [];

        for (const p of projects) {
          const threadList = await backend.listThreads(p.id);
          const threadsWithMessages = await Promise.all(
            threadList.map(async (t) => {
              const msgs = await backend.listMessages(t.id);
              return {
                id: t.id,
                agentId: t.agentId,
                title: t.title,
                messages: msgs.map((m) => ({
                  id: m.id,
                  agentId: m.agentId,
                  actorType: m.actorType,
                  actorName: m.actorName,
                  content: m.content,
                  createdAt: m.createdAt,
                })),
              };
            })
          );
          projectsWithThreads.push({
            id: p.id,
            name: p.name,
            slug: p.slug,
            goals: p.goals ?? null,
            threads: threadsWithMessages,
          });
        }

        const data = { projects: projectsWithThreads };
        const text = JSON.stringify(data, null, 2);
        return {
          content: [{ type: "text", text }],
          structuredContent: data,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${msg}` }],
          isError: true,
        };
      }
    }
  );

  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      const dir = getDistDir();
      const html = await fs.readFile(path.join(dir, "mcp-app.html"), "utf-8");
      return {
        contents: [
          { uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html },
        ],
      };
    }
  );

  return server;
}
