import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Default root for agent data: repo_root/agents (or AGENTS_STORAGE_PATH). */
export function getAgentsStorageRoot(): string {
  const fromEnv = process.env.AGENTS_STORAGE_PATH;
  if (fromEnv) return path.resolve(fromEnv);
  const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
  return path.join(repoRoot, "agents");
}

/** Filesystem-safe slug from agent role (e.g. "Code Engineer" → "code-engineer"). */
export function agentRoleToSlug(role: string): string {
  return role
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

/** Directory name for one agent: {id}-{role-slug} (id = UUID). */
export function getAgentDirName(agent: { id: string; role: string }): string {
  const slug = agentRoleToSlug(agent.role) || "agent";
  return `${agent.id}-${slug}`;
}

/** Full path: agents/{agentDirName}/ */
export function getAgentDir(agent: { id: string; role: string }): string {
  const root = getAgentsStorageRoot();
  const dirName = getAgentDirName(agent);
  return path.join(root, dirName);
}

/** Full path: agents/{agentDirName}/mcp.json (MCP config – one per agent, shared across projects). */
export function getMcpConfigPath(agent: { id: string; role: string }): string {
  return path.join(getAgentDir(agent), "mcp.json");
}

/** Full path: agents/{agentDirName}/skills/ (skills config – one per agent, shared across projects). */
export function getSkillsDir(agent: { id: string; role: string }): string {
  return path.join(getAgentDir(agent), "skills");
}

/** Full path: agents/{agentDirName}/{projectId}/ (project = artifacts only). */
export function getProjectDir(
  agent: { id: string; role: string },
  projectId: string
): string {
  const safeProjectId = projectId.replace(/[^a-z0-9_-]/gi, "_");
  return path.join(getAgentDir(agent), safeProjectId);
}

/** Full path: agents/{agentDirName}/{projectId}/artifacts/ */
export function getArtifactsDir(
  agent: { id: string; role: string },
  projectId: string
): string {
  return path.join(getProjectDir(agent, projectId), "artifacts");
}

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

/** Ensures agent dir + mcp.json + skills/ (MCP and skills live at agent level). */
export function ensureAgentDir(agent: { id: string; role: string }): string {
  const agentDir = getAgentDir(agent);
  const skillsDir = getSkillsDir(agent);
  const mcpPath = getMcpConfigPath(agent);

  ensureDir(skillsDir);
  if (!fs.existsSync(mcpPath)) {
    fs.writeFileSync(
      mcpPath,
      JSON.stringify({ mcp: [], comment: "MCP config for this agent" }, null, 2)
    );
  }
  return agentDir;
}

/** Ensures project dir + artifacts/ only (MCP/skills are at agent level). */
export function ensureAgentProjectLayout(
  agent: { id: string; role: string },
  projectId: string
): { agentDir: string; projectDir: string; artifactsDir: string } {
  const agentDir = getAgentDir(agent);
  const projectDir = getProjectDir(agent, projectId);
  const artifactsDir = getArtifactsDir(agent, projectId);

  ensureDir(artifactsDir);
  return { agentDir, projectDir, artifactsDir };
}
