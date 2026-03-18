/**
 * @pixel-org/agent-runner
 *
 * Invokes agent CLIs (Cursor CLI, Claude Code, etc.) for orchestration.
 * Responsibilities:
 * - Spawn the correct CLI with role and task context
 * - Set env (e.g. PIXEL_AGENT_ROLE) so the agent can follow AGENTS.md
 * - Capture stdout/stderr, timeout, exit code
 *
 * Orchestration logic (which agent to run, when, with what task) lives in
 * the backend; this module only executes the CLI.
 */

export type {
  RunAgentOptions,
  RunAgentResult,
  VisibleAgentWork,
  VisibleProject,
} from "./types.js";

export { runAgent } from "./runAgent.js";
