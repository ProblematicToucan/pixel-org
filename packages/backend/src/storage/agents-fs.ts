import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { renderLeadOrchestratorAgentsMd } from "./agent-template.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repo root (parent of agents dir). Used for Pixel MCP server path. */
export function getRepoRoot(): string {
  return path.dirname(getAgentsStorageRoot());
}

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

/** Full path: agents/{agentDirName}/.cursor/mcp.json or .claude/mcp.json (MCP config per agent). */
export function getMcpConfigPath(agent: { id: string; role: string }): string {
  const cursorPath = path.join(getAgentDir(agent), ".cursor", "mcp.json");
  const claudePath = path.join(getAgentDir(agent), ".claude", "mcp.json");
  if (fs.existsSync(cursorPath)) return cursorPath;
  if (fs.existsSync(claudePath)) return claudePath;
  return cursorPath;
}

/** Full paths for both supported per-agent MCP config files. */
export function getAllMcpConfigPaths(agent: { id: string; role: string }): {
  cursorPath: string;
  claudePath: string;
} {
  const base = getAgentDir(agent);
  return {
    cursorPath: path.join(base, ".cursor", "mcp.json"),
    claudePath: path.join(base, ".claude", "mcp.json"),
  };
}

/** Full path: agents/{agentDirName}/.agents/skills/ (skills config – one per agent, shared across projects). */
export function getSkillsDir(agent: { id: string; role: string }): string {
  return path.join(getAgentDir(agent), ".agents", "skills");
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

/** Ensures agent dir + .cursor/.claude mcp.json + .agents/skills/. */
export function ensureAgentDir(agent: { id: string; role: string }): string {
  const agentDir = getAgentDir(agent);
  const skillsDir = getSkillsDir(agent);
  const { cursorPath, claudePath } = getAllMcpConfigPaths(agent);
  const preferredPath = getMcpConfigPath(agent);
  const legacyMcpPath = path.join(agentDir, ".agents", "mcp.json");
  const seedPath = fs.existsSync(preferredPath)
    ? preferredPath
    : (fs.existsSync(legacyMcpPath) ? legacyMcpPath : null);

  // Keep both config files present so either CLI can run from the same workspace.
  ensureDir(path.dirname(cursorPath));
  ensureDir(path.dirname(claudePath));
  ensureDir(skillsDir);
  if (seedPath) {
    if (!fs.existsSync(cursorPath)) fs.copyFileSync(seedPath, cursorPath);
    if (!fs.existsSync(claudePath)) fs.copyFileSync(seedPath, claudePath);
  } else {
    const emptyConfig = JSON.stringify({ mcpServers: {} }, null, 2);
    if (!fs.existsSync(cursorPath)) fs.writeFileSync(cursorPath, emptyConfig);
    if (!fs.existsSync(claudePath)) fs.writeFileSync(claudePath, emptyConfig);
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

/** Full path: agents/{agentDirName}/AGENTS.md (persona for CLI). */
export function getAgentsMdPath(agent: { id: string; role: string }): string {
  return path.join(getAgentDir(agent), "AGENTS.md");
}

export function getAgentsMdConfigPointer(agent: { id: string; role: string }): string {
  return getAgentsMdPath(agent);
}

export function readAgentConfigDisplay(agent: { id: string; role: string; config: string | null }): string | null {
  const pointer = agent.config?.trim() ?? "";
  const absolutePath = pointer.startsWith("file://")
    ? pointer.slice("file://".length)
    : pointer;
  if (absolutePath && path.isAbsolute(absolutePath) && fs.existsSync(absolutePath)) {
    return fs.readFileSync(absolutePath, "utf-8");
  }
  return agent.config;
}

/** Absolute path to Pixel MCP server entry script (repo root relative). */
export function getPixelMcpServerPath(): string {
  return path.join(getRepoRoot(), "packages", "pixel-mcp-server", "dist", "main.js");
}

/** Source dir for pixel-backend skill (to copy into each agent). */
function getPixelBackendSkillSourceDir(): string {
  return path.join(getRepoRoot(), "packages", "pixel-mcp-server", "skills", "pixel-backend");
}

/** Agent row shape for provisioning (id, name, role, config). */
export type AgentForProvision = { id: string; name: string; role: string; config: string | null };

/** Write AGENTS.md from name, role, and plain-text config. */
export function writeAgentsMd(agent: AgentForProvision): void {
  const p = getAgentsMdPath(agent);
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, renderLeadOrchestratorAgentsMd(agent), "utf-8");
}

/** Write .cursor/.claude mcp.json with Pixel MCP server entry (absolute path, env for this agent). */
export function writeMcpJson(agent: { id: string; role: string }): void {
  const { cursorPath, claudePath } = getAllMcpConfigPaths(agent);
  ensureDir(path.dirname(cursorPath));
  ensureDir(path.dirname(claudePath));
  const serverPath = getPixelMcpServerPath();
  const payload = {
    mcpServers: {
      "pixel-backend": {
        command: "node",
        args: [serverPath],
        env: {
          PIXEL_BACKEND_URL: process.env.PIXEL_BACKEND_URL || "http://localhost:3000",
          PIXEL_AGENT_ID: agent.id,
        },
      },
    },
  };
  const content = JSON.stringify(payload, null, 2);
  fs.writeFileSync(cursorPath, content, "utf-8");
  fs.writeFileSync(claudePath, content, "utf-8");
}

/** Copy pixel-backend skill into agent .agents/skills/pixel-backend/. */
export function copyPixelBackendSkill(agent: { id: string; role: string }): void {
  const src = getPixelBackendSkillSourceDir();
  const destDir = getSkillsDir(agent);
  const dest = path.join(destDir, "pixel-backend");
  ensureDir(dest);
  const skillFile = path.join(src, "SKILL.md");
  if (fs.existsSync(skillFile)) {
    fs.copyFileSync(skillFile, path.join(dest, "SKILL.md"));
  }
}

/**
 * Full provisioning: ensure dir, write AGENTS.md, mcp.json, and copy pixel-backend skill.
 * Call after creating/updating an agent so the CLI has persona + MCP + skills.
 */
export function provisionAgentWorkspace(agent: AgentForProvision): string {
  ensureAgentDir(agent);
  writeAgentsMd(agent);
  writeMcpJson(agent);
  copyPixelBackendSkill(agent);
  return getAgentDir(agent);
}
