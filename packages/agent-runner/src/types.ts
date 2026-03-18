export interface RunAgentOptions {
  /** Which agent CLI to use (e.g. "cursor", "claude-code") */
  provider: "cursor" | "claude-code";
  /** Role for this run (agent’s role string). Passed as PIXEL_AGENT_ROLE. */
  role: string;
  /** Task or prompt to send to the agent */
  task: string;
  /** Working directory for the agent */
  cwd?: string;
  /** Optional timeout in ms */
  timeoutMs?: number;
  /** Extra env vars (e.g. PIXEL_AGENT_ROLE is set from role) */
  env?: Record<string, string>;
}

export interface RunAgentResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
}
