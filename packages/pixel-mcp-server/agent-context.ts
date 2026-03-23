/**
 * Assembles structured backend context + Mem0 recall for `pixel_get_context`.
 */

import * as backend from "./backend.js";
import {
  formatMemoriesForPrompt,
  isMemoryConfigured,
  mem0UserId,
  searchMemories,
} from "./memory.js";

const DEFAULT_QUERY =
  "Strategic goals, key decisions, preferences, priorities, and main ideas for this simulation.";

export async function buildAgentContextBlock(options: {
  projectId?: string;
  query?: string;
  includeVisibleWork?: boolean;
}): Promise<string> {
  const agentId = backend.getCurrentAgentId();
  const agent = await backend.getAgent(agentId);

  const lines: string[] = [];
  lines.push(`[PIXEL CONTEXT — agent: ${agent.name} (${agent.role})]`);
  lines.push("");
  lines.push("## Agent (structured)");
  lines.push(`- id: ${agent.id}`);
  lines.push(`- name: ${agent.name}`);
  lines.push(`- role: ${agent.role}`);
  lines.push(`- is_lead: ${Boolean(agent.isLead)}`);
  lines.push("");

  let projectGoals: string | null = null;
  if (options.projectId?.trim()) {
    try {
      const p = await backend.getProject(options.projectId.trim());
      projectGoals = p.goals ?? null;
      lines.push("## Current project");
      lines.push(`- project_id: ${p.id}`);
      lines.push(`- name: ${p.name}`);
      lines.push(`- slug: ${p.slug}`);
      lines.push(`- goals:\n${projectGoals ?? "(none set)"}`);
      lines.push("");
    } catch {
      lines.push("## Current project");
      lines.push(`- (could not load project ${options.projectId})`);
      lines.push("");
    }
  }

  if (options.includeVisibleWork) {
    try {
      const work = await backend.getVisibleWork();
      lines.push("## Visible work (project paths)");
      lines.push(JSON.stringify(work, null, 2));
      lines.push("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lines.push("## Visible work");
      lines.push(`(error: ${msg})`);
      lines.push("");
    }
  }

  const userId = mem0UserId(agentId, options.projectId?.trim());
  lines.push("## Semantic memory (Mem0 OSS)");
  if (!isMemoryConfigured()) {
    lines.push(
      "(Mem0 OSS disabled: set OPENAI_API_KEY in the MCP server env for embedder + LLM. See https://docs.mem0.ai/open-source/node-quickstart )"
    );
  } else {
    const q = (options.query ?? "").trim() || DEFAULT_QUERY;
    try {
      const memories = await searchMemories(userId, q, 8);
      lines.push(formatMemoriesForPrompt(memories));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lines.push(`(Mem0 search failed: ${msg}. Structured context above is still valid.)`);
    }
  }

  return lines.join("\n");
}
