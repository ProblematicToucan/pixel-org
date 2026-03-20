import { spawn } from "node:child_process";
import type { RunAgentOptions, RunAgentResult } from "./types.js";

const ROLE_ENV_KEY = "PIXEL_AGENT_ROLE";
const VISIBLE_WORK_ENV_KEY = "PIXEL_VISIBLE_WORK";
const AGENT_ID_ENV_KEY = "PIXEL_AGENT_ID";
const BACKEND_URL_ENV_KEY = "PIXEL_BACKEND_URL";

/**
 * Invokes the configured agent CLI with the given role and task.
 * Caller (orchestrator) is responsible for choosing provider, role, and task.
 * If visibleWork is provided (e.g. from GET /agents/:id/visible-work), the CLI can read those artifact paths to review report work.
 * If agentId/backendUrl are provided, the Pixel MCP server (in .cursor/.claude mcp.json) can use them to talk to the backend.
 */
export async function runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
  const { provider, role, task, cwd = process.cwd(), timeoutMs, visibleWork, agentId, backendUrl, env = {} } = options;

  const baseEnv: Record<string, string> = {
    ...process.env,
    [ROLE_ENV_KEY]: role,
    ...env,
  };
  if (visibleWork != null && visibleWork.length > 0) {
    baseEnv[VISIBLE_WORK_ENV_KEY] = JSON.stringify(visibleWork);
  }
  if (agentId != null && agentId !== "") {
    baseEnv[AGENT_ID_ENV_KEY] = agentId;
  }
  if (backendUrl != null && backendUrl !== "") {
    baseEnv[BACKEND_URL_ENV_KEY] = backendUrl.replace(/\/$/, "");
  }

  const canReadOutsideWorkspace = visibleWork != null && visibleWork.length > 0;
  const { command, args } = getCliInvocation(provider, task, cwd, canReadOutsideWorkspace);

  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd,
      env: baseEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (chunk) => { stdout += chunk; });
    proc.stderr?.on("data", (chunk) => { stderr += chunk; });

    let timedOut = false;
    const timer =
      timeoutMs != null
        ? setTimeout(() => {
            timedOut = true;
            proc.kill("SIGTERM");
          }, timeoutMs)
        : undefined;

    proc.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      resolve({
        success: code === 0 && !timedOut,
        stdout,
        stderr,
        exitCode: code ?? (signal ? -1 : 0),
        timedOut: timedOut || undefined,
      });
    });

    proc.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({
        success: false,
        stdout,
        stderr: stderr || err.message,
        exitCode: -1,
      });
    });
  });
}

/**
 * Map provider + task to CLI command and args.
 * --workspace <cwd>: agent runs in their own dir (so MCP/skills load from there).
 * When canReadOutsideWorkspace (e.g. CEO reviewing Engineer): add --sandbox disabled so the agent
 * can read absolute paths in PIXEL_VISIBLE_WORK that point to other agents' dirs (e.g. /path/to/engineer/project_1/artifacts).
 */
function getCliInvocation(
  provider: "cursor" | "claude-code",
  task: string,
  cwd: string,
  canReadOutsideWorkspace: boolean
): { command: string; args: string[] } {
  switch (provider) {
    case "cursor": {
      const args = ["--print", "--trust", "-f", "--workspace", cwd];
      if (canReadOutsideWorkspace) {
        args.push("--sandbox", "disabled");
      }
      args.push(task);
      return { command: "agent", args };
    }
    case "claude-code":
      return { command: "claude-code", args: [task] };
    default: {
      const args = ["--print", "--trust", "-f", "--workspace", cwd];
      if (canReadOutsideWorkspace) {
        args.push("--sandbox", "disabled");
      }
      args.push(task);
      return { command: "agent", args };
    }
  }
}
