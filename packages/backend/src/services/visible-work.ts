import fs from "fs";
import { stat } from "fs/promises";
import { eq, inArray } from "drizzle-orm";
import { agents, projects } from "../db/schema.js";
import { getAgentDir, getProjectDir } from "../storage/agents-fs.js";

type Db = typeof import("../db/index.js").db;

/**
 * Whether requester may create a thread owned by ownerAgentId.
 * - Always allowed if requester === owner (self).
 * - Otherwise: only leads may assign, and owner must be in requester's org subtree (self + descendants).
 */
export async function canAssignThreadOwner(
  db: Db,
  requesterId: string,
  ownerId: string
): Promise<boolean> {
  if (requesterId === ownerId) return true;
  const [requester] = await db.select().from(agents).where(eq(agents.id, requesterId)).limit(1);
  if (!requester?.isLead) return false;
  const descendants = await getDescendantAgents(db, requesterId);
  return descendants.some((d) => d.id === ownerId);
}

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

export type ActorRelation = "self" | "descendant" | "ancestor" | "unrelated";

/**
 * Resolve actor relation relative to target.
 * - descendant: target is in actor's org subtree
 * - ancestor: actor is in target's org subtree
 */
export async function resolveActorRelation(
  db: Db,
  actorId: string,
  targetId: string
): Promise<ActorRelation> {
  if (actorId === targetId) return "self";
  const actorDescendants = await getDescendantAgents(db, actorId);
  if (actorDescendants.some((a) => a.id === targetId)) return "descendant";
  const targetDescendants = await getDescendantAgents(db, targetId);
  if (targetDescendants.some((a) => a.id === actorId)) return "ancestor";
  return "unrelated";
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

export type LinkedProject = { id: string; name: string; slug: string };
export type VisibleProject = {
  projectId: string;
  /** Per-agent project workspace: `{agentDir}/{projectId}/` (repo, source, artifacts, etc.). */
  projectPath: string;
  /** DB project when folder name matches `projects.id` or `projects.slug`. */
  linkedProject: LinkedProject | null;
};
export type VisibleAgentWork = {
  agentId: string;
  name: string;
  role: string;
  agentDir: string;
  projects: VisibleProject[];
};

export type ProjectAgentWorkspace = {
  agentId: string;
  name: string;
  role: string;
  agentDir: string;
  projectPath: string;
};

/** Map folder name (uuid or slug) → project summary for visible-work enrichment. */
async function buildProjectLookup(db: Db, folderNames: string[]): Promise<Map<string, LinkedProject>> {
  const map = new Map<string, LinkedProject>();
  if (folderNames.length === 0) return map;

  const byId = await db.select().from(projects).where(inArray(projects.id, folderNames));
  for (const r of byId) {
    map.set(r.id, { id: r.id, name: r.name, slug: r.slug });
  }

  const missing = folderNames.filter((n) => !map.has(n));
  if (missing.length === 0) return map;

  const bySlug = await db.select().from(projects).where(inArray(projects.slug, missing));
  for (const r of bySlug) {
    if (!map.has(r.slug)) {
      map.set(r.slug, { id: r.id, name: r.name, slug: r.slug });
    }
  }
  return map;
}

/**
 * Agents that have `{storage}/{agentDir}/{projectId}/` on disk for this DB project.
 * Folder name is the project UUID (or legacy slug folder).
 */
export async function getAgentWorkspacesForProject(
  db: Db,
  projectId: string
): Promise<ProjectAgentWorkspace[] | null> {
  const [proj] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!proj) return null;

  const allAgents = await db
    .select({ id: agents.id, name: agents.name, role: agents.role })
    .from(agents);

  const entries = await Promise.all(
    allAgents.map(async (agent) => {
      const projectPath = getProjectDir(agent, projectId);
      try {
        const s = await stat(projectPath);
        if (!s.isDirectory()) return null;
        return {
          agentId: agent.id,
          name: agent.name,
          role: agent.role,
          agentDir: getAgentDir(agent),
          projectPath,
        };
      } catch (err: unknown) {
        const code = err && typeof err === "object" && "code" in err ? (err as NodeJS.ErrnoException).code : undefined;
        if (code === "ENOENT") return null;
        throw err;
      }
    })
  );

  return entries.filter((ws): ws is ProjectAgentWorkspace => ws !== null);
}

/**
 * Work the given agent can "see": self + all reports' agent dirs and per-project workspace paths.
 * CEO sees everyone; CTO sees CTO + Engineer; Engineer sees only self.
 */
export async function getVisibleWork(db: Db, agentId: string): Promise<VisibleAgentWork[]> {
  const agentsList = await getDescendantAgents(db, agentId);
  const out: VisibleAgentWork[] = [];

  for (const agent of agentsList) {
    const agentDir = getAgentDir(agent);
    const projectIds = listProjectIdsForAgent(agent);
    const agentProjects: VisibleProject[] = projectIds.map((pid) => ({
      projectId: pid,
      projectPath: getProjectDir(agent, pid),
      linkedProject: null,
    }));

    out.push({
      agentId: agent.id,
      name: agent.name,
      role: agent.role,
      agentDir,
      projects: agentProjects,
    });
  }

  const allFolderNames = [...new Set(out.flatMap((w) => w.projects.map((p) => p.projectId)))];
  const lookup = await buildProjectLookup(db, allFolderNames);
  for (const w of out) {
    w.projects = w.projects.map((p) => ({
      ...p,
      linkedProject: lookup.get(p.projectId) ?? null,
    }));
  }

  return out;
}
