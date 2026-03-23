/** One project's workspace path (from GET /agents/:id/visible-work). */
export interface LinkedProject {
  id: string;
  name: string;
  slug: string;
}

export interface VisibleProject {
  projectId: string;
  projectPath: string;
  linkedProject: LinkedProject | null;
}

/** One agent's visible work (self or report). CLI can read files under each project's projectPath. */
export interface VisibleAgentWork {
  agentId: string;
  name: string;
  role: string;
  agentDir: string;
  projects: VisibleProject[];
}

export interface RunAgentOptions {
  /** Which agent CLI to use (e.g. "cursor", "claude-code") */
  provider: "cursor" | "claude-code";
  /** Role for this run (agent's role string). Passed as PIXEL_AGENT_ROLE. */
  role: string;
  /** Task or prompt to send to the agent */
  task: string;
  /** Working directory for the agent (`--workspace` + spawn cwd; Pixel orchestration uses per-project dir). */
  cwd?: string;
  /** Optional timeout in ms */
  timeoutMs?: number;
  /** Visible work (e.g. from GET /agents/:id/visible-work). Set as PIXEL_VISIBLE_WORK so the CLI can read report project dirs and review code. */
  visibleWork?: VisibleAgentWork[];
  /** Agent UUID. When set, passed as PIXEL_AGENT_ID so the Pixel MCP server can identify the agent. */
  agentId?: string;
  /** Backend base URL (e.g. http://localhost:3000). When set, passed as PIXEL_BACKEND_URL for the Pixel MCP server. */
  backendUrl?: string;
  /**
   * Model id for Cursor `agent` (`--model`) and `PIXEL_MODEL` env.
   * Should match the orchestration run record. Default `"auto"`.
   */
  model?: string;
  /** When set, headless CLI resumes this session id (e.g. Cursor `agent --resume <id>`). */
  resumeSessionId?: string;
  /** Extra env vars (e.g. PIXEL_AGENT_ROLE is set from role) */
  env?: Record<string, string>;
  /** Optional callback fired immediately after child process spawn. */
  onSpawn?: (meta: { pid?: number; command: string; args: string[] }) => void;
}

export interface RunAgentResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
  pid?: number;
  command?: string;
  args?: string[];
}
