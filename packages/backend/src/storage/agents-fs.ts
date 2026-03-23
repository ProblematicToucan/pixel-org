import path from "path";
import fs from "fs";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { renderLeadOrchestratorAgentsMd } from "./agent-template.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Monorepo root (this package: packages/backend/src/storage → four levels up). */
export function getRepoRoot(): string {
  return path.resolve(__dirname, "..", "..", "..", "..");
}

/** Default: ~/.pixel-org (or AGENTS_STORAGE_PATH). Keeps agent workspaces out of the repo. */
export function getAgentsStorageRoot(): string {
  const fromEnv = process.env.AGENTS_STORAGE_PATH;
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(homedir(), ".pixel-org");
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

/** Full path: {storageRoot}/{agentDirName}/ */
export function getAgentDir(agent: { id: string; role: string }): string {
  const root = getAgentsStorageRoot();
  const dirName = getAgentDirName(agent);
  return path.join(root, dirName);
}

/** Full path: {storageRoot}/{agentDirName}/.cursor/mcp.json or .claude/mcp.json (MCP config per agent). */
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

/** Full path: {storageRoot}/{agentDirName}/.agents/skills/ (skills config – one per agent, shared across projects). */
export function getSkillsDir(agent: { id: string; role: string }): string {
  return path.join(getAgentDir(agent), ".agents", "skills");
}

/** Full path: {storageRoot}/{agentDirName}/{projectId}/ (project = artifacts only). */
export function getProjectDir(
  agent: { id: string; role: string },
  projectId: string
): string {
  const safeProjectId = projectId.replace(/[^a-z0-9_-]/gi, "_");
  return path.join(getAgentDir(agent), safeProjectId);
}

/** Full path: {storageRoot}/{agentDirName}/{projectId}/artifacts/ */
export function getArtifactsDir(
  agent: { id: string; role: string },
  projectId: string
): string {
  return path.join(getProjectDir(agent, projectId), "artifacts");
}

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

/** Write UTF-8 file only if content differs (avoids churning mtime and redundant I/O). */
function writeFileUtf8IfChanged(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  if (fs.existsSync(filePath)) {
    try {
      const existing = fs.readFileSync(filePath, "utf-8");
      if (existing === content) return;
    } catch {
      // fall through to write
    }
  }
  fs.writeFileSync(filePath, content, "utf-8");
}

/**
 * Ensures `linkPath` is a symlink to `absTarget`. Replaces wrong symlinks, files, or dirs.
 * Uses `file` vs `dir` type for Windows; on Unix the third arg is ignored for most cases.
 */
function ensureSymlinkToTarget(absTarget: string, linkPath: string, linkKind: "file" | "dir"): void {
  const resolvedTarget = path.resolve(absTarget);
  ensureDir(path.dirname(linkPath));
  if (fs.existsSync(linkPath)) {
    try {
      const st = fs.lstatSync(linkPath);
      if (st.isSymbolicLink()) {
        const cur = fs.readlinkSync(linkPath);
        const curAbs = path.isAbsolute(cur) ? path.resolve(cur) : path.resolve(path.dirname(linkPath), cur);
        if (path.resolve(curAbs) === resolvedTarget) return;
      }
    } catch {
      // replace
    }
    fs.rmSync(linkPath, { recursive: true, force: true });
  }
  fs.symlinkSync(resolvedTarget, linkPath, linkKind === "dir" ? "dir" : "file");
}

/** Copy file if dest missing or source newer/different size (template/skill updates). */
function copyFileIfStale(src: string, dest: string): void {
  if (!fs.existsSync(src)) return;
  ensureDir(path.dirname(dest));
  if (!fs.existsSync(dest)) {
    fs.copyFileSync(src, dest);
    return;
  }
  const srcStat = fs.statSync(src);
  const destStat = fs.statSync(dest);
  if (srcStat.mtimeMs > destStat.mtimeMs || srcStat.size !== destStat.size) {
    fs.copyFileSync(src, dest);
  }
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

/**
 * Symlink AGENTS.md, `.cursor`/`.claude` mcp.json, and `.agents` from the agent home into
 * `projectDir` so the Cursor CLI can use `projectDir` as `--workspace` while still loading the
 * same persona, MCP, and skills as the canonical files under `agentDir`.
 */
export function syncProjectWorkspaceSymlinks(
  agent: { id: string; role: string },
  projectId: string
): void {
  const agentDir = getAgentDir(agent);
  const projectDir = getProjectDir(agent, projectId);
  const { cursorPath, claudePath } = getAllMcpConfigPaths(agent);
  const agentsMd = getAgentsMdPath(agent);
  const agentDotAgents = path.join(agentDir, ".agents");

  ensureSymlinkToTarget(agentsMd, path.join(projectDir, "AGENTS.md"), "file");
  ensureSymlinkToTarget(cursorPath, path.join(projectDir, ".cursor", "mcp.json"), "file");
  ensureSymlinkToTarget(claudePath, path.join(projectDir, ".claude", "mcp.json"), "file");
  ensureSymlinkToTarget(agentDotAgents, path.join(projectDir, ".agents"), "dir");
}

/** Ensures project dir + artifacts/ + workspace symlinks (AGENTS.md, MCP, skills) for CLI `--workspace`. */
export function ensureAgentProjectLayout(
  agent: { id: string; role: string },
  projectId: string
): { agentDir: string; projectDir: string; artifactsDir: string } {
  const agentDir = getAgentDir(agent);
  const projectDir = getProjectDir(agent, projectId);
  const artifactsDir = getArtifactsDir(agent, projectId);

  ensureDir(artifactsDir);
  syncProjectWorkspaceSymlinks(agent, projectId);
  return { agentDir, projectDir, artifactsDir };
}

/** Full path: {storageRoot}/{agentDirName}/AGENTS.md (persona for CLI). */
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
  writeFileUtf8IfChanged(p, renderLeadOrchestratorAgentsMd(agent));
}

/** Write .cursor/.claude mcp.json with Pixel MCP server entry (absolute path, env for this agent). */
export function writeMcpJson(agent: { id: string; role: string }): void {
  const { cursorPath, claudePath } = getAllMcpConfigPaths(agent);
  ensureDir(path.dirname(cursorPath));
  ensureDir(path.dirname(claudePath));
  const serverPath = getPixelMcpServerPath();
  const serverName = `pixel-backend-${agent.id}`;
  const payload = {
    mcpServers: {
      [serverName]: {
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
  writeFileUtf8IfChanged(cursorPath, content);
  writeFileUtf8IfChanged(claudePath, content);
}

/** Copy pixel-backend skill into agent .agents/skills/pixel-backend/. */
export function copyPixelBackendSkill(agent: { id: string; role: string }): void {
  const src = getPixelBackendSkillSourceDir();
  const destDir = getSkillsDir(agent);
  const dest = path.join(destDir, "pixel-backend");
  ensureDir(dest);
  const skillFile = path.join(src, "SKILL.md");
  if (fs.existsSync(skillFile)) {
    copyFileIfStale(skillFile, path.join(dest, "SKILL.md"));
  }
}

/**
 * Full provisioning: ensure dir, write AGENTS.md, mcp.json, and copy pixel-backend skill.
 * Writes are skipped when content is unchanged (reduces I/O on every agent run).
 * Call after creating/updating an agent so the CLI has persona + MCP + skills.
 */
export function provisionAgentWorkspace(agent: AgentForProvision): string {
  ensureAgentDir(agent);
  writeAgentsMd(agent);
  writeMcpJson(agent);
  copyPixelBackendSkill(agent);
  return getAgentDir(agent);
}
