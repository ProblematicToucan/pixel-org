/**
 * Mem0 open-source semantic memory (`mem0ai/oss`), scoped by agent (+ optional project).
 * Requires OPENAI_API_KEY for embedder + LLM (see https://docs.mem0.ai/open-source/node-quickstart ).
 */

import { Memory, type MemoryItem } from "mem0ai/oss";

let memory: Memory | null | undefined;

function getOpenAiKey(): string | undefined {
  return process.env.OPENAI_API_KEY?.trim() || undefined;
}

export function isMemoryConfigured(): boolean {
  return Boolean(getOpenAiKey());
}

/**
 * OSS Memory runs locally (in-memory vector store + optional SQLite history).
 * Models match the Mem0 Node quickstart “production” example.
 */
function getMemory(): Memory | null {
  if (memory !== undefined) {
    return memory;
  }
  const apiKey = getOpenAiKey();
  if (!apiKey) {
    memory = null;
    return null;
  }
  const historyDbPath = process.env.PIXEL_MEM0_HISTORY_DB?.trim();

  memory = new Memory({
    version: "v1.1",
    embedder: {
      provider: "openai",
      config: {
        apiKey,
        model: process.env.MEM0_EMBED_MODEL?.trim() || "text-embedding-3-small",
      },
    },
    vectorStore: {
      provider: "memory",
      config: {
        collectionName: process.env.MEM0_VECTOR_COLLECTION?.trim() || "pixel_memories",
        dimension: 1536,
      },
    },
    llm: {
      provider: "openai",
      config: {
        apiKey,
        model: process.env.MEM0_LLM_MODEL?.trim() || "gpt-4.1-nano-2025-04-14",
      },
    },
    ...(historyDbPath ? { historyDbPath } : {}),
  });
  return memory;
}

/**
 * Mem0 user id: one namespace per agent; optional project isolates project-specific memory.
 */
export function mem0UserId(agentId: string, projectId?: string): string {
  if (projectId?.trim()) {
    return `pixel:${agentId}:p:${projectId.trim()}`;
  }
  return `pixel:${agentId}:global`;
}

const DEFAULT_SEARCH =
  "Strategic goals, key decisions, preferences, priorities, and recurring themes for this agent.";

export async function searchMemories(
  userId: string,
  query: string = DEFAULT_SEARCH,
  limit: number = 8
): Promise<MemoryItem[]> {
  const m = getMemory();
  if (!m) {
    return [];
  }
  const q = query.trim() || DEFAULT_SEARCH;
  const result = await m.search(q, { userId, limit });
  return result.results ?? [];
}

export function formatMemoriesForPrompt(memories: MemoryItem[]): string {
  if (memories.length === 0) {
    return "(no semantic memories retrieved)";
  }
  return memories
    .map((item, i) => {
      const text = typeof item.memory === "string" ? item.memory : JSON.stringify(item);
      const score = typeof item.score === "number" ? ` (score: ${item.score.toFixed(3)})` : "";
      return `${i + 1}. ${text}${score}`;
    })
    .join("\n");
}

export type StoreMemoryCategory = "decision" | "insight" | "preference" | "fact" | "other";

export async function addMemory(params: {
  userId: string;
  content: string;
  category?: StoreMemoryCategory;
}): Promise<void> {
  const m = getMemory();
  if (!m) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  const content = params.content.trim();
  if (!content) {
    throw new Error("Memory content is empty");
  }
  await m.add([{ role: "user", content }], {
    userId: params.userId,
    infer: false,
    metadata: {
      source: "pixel-mcp",
      category: params.category ?? "other",
    },
  });
}
