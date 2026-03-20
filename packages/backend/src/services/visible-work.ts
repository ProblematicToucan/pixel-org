import fs from "fs";
import { agents } from "../db/schema.js";
import { getAgentDir, getArtifactsDir } from "../storage/agents-fs.js";

type Db = typeof import("../db/index.js").db;

/** All agents that are self or descendants (reports) of the given agent. */
export async function getDescendantAgents(
  db: Db,
  agentId: string
): Promise<{ id: string; name: string; role: string }[]> {
  const all = await db.select().from(agents);
  const byId = new Map(all.map((a) => [a.id, a]));
  const result: { id: string; name: string; role: string }[] = [];
  const queue = [agentId];

  while (queue.length > 0) {
    const id = queue.shift()!;
    const agent = byId.get(id);
    if (!agent) continue;
    result.push({ id: agent.id, name: agent.name, role: agent.role });
    const reports = all.filter((a) => a.parentId === id);
    queue.push(...reports.map((a) => a.id));
  }

  return result;
}

/** List project ids for an agent by reading their dir on disk (subdirs other than skills). */
function listProjectIdsForAgent(agent: { id: string; role: string }): string[] {
  const agentDir = getAgentDir(agent);
  if (!fs.existsSync(agentDir) || !fs.statSync(agentDir).isDirectory()) return [];
  const entries = fs.readdirSync(agentDir, { withFileTypes: true });
  const projectIds: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    // Skip non-project directories at agent root.
    if (e.name === ".agents") continue;
    if (e.name === ".claude") continue;
    if (e.name === ".cursor") continue;
    // Back-compat: older layout kept `skills/` at agent root.
    if (e.name === "skills") continue;
    projectIds.push(e.name);
  }
  return projectIds;
}

export type VisibleProject = { projectId: string; artifactsPath: string };
export type VisibleAgentWork = {
  agentId: string;
  name: string;
  role: string;
  agentDir: string;
  projects: VisibleProject[];
};

/**
 * Work the given agent can "see": self + all reports' agent dirs and artifact paths.
 * CEO sees everyone; CTO sees CTO + Engineer; Engineer sees only self.
 */
export async function getVisibleWork(db: Db, agentId: string): Promise<VisibleAgentWork[]> {
  const agentsList = await getDescendantAgents(db, agentId);
  const out: VisibleAgentWork[] = [];

  for (const agent of agentsList) {
    const agentDir = getAgentDir(agent);
    const projectIds = listProjectIdsForAgent(agent);
    const projects: VisibleProject[] = projectIds.map((projectId) => ({
      projectId,
      artifactsPath: getArtifactsDir(agent, projectId),
    }));

    out.push({
      agentId: agent.id,
      name: agent.name,
      role: agent.role,
      agentDir,
      projects,
    });
  }

  return out;
}
