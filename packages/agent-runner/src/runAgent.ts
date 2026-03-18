import { spawn } from "node:child_process";
import type { RunAgentOptions, RunAgentResult } from "./types.js";

const ROLE_ENV_KEY = "PIXEL_AGENT_ROLE";

/**
 * Invokes the configured agent CLI with the given role and task.
 * Caller (orchestrator) is responsible for choosing provider, role, and task.
 */
export async function runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
  const { provider, role, task, cwd = process.cwd(), timeoutMs, env = {} } = options;

  const baseEnv = {
    ...process.env,
    [ROLE_ENV_KEY]: role,
    ...env,
  };

  const { command, args } = getCliInvocation(provider, task);

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
 * Adjust for real Cursor/Claude CLI usage (flags, stdin, etc.).
 */
function getCliInvocation(
  provider: "cursor" | "claude-code",
  task: string
): { command: string; args: string[] } {
  switch (provider) {
    case "cursor":
      // Example: cursor agent run or cursor -- <task>
      return { command: "cursor", args: ["agent", "run", "--task", task] };
    case "claude-code":
      // Example: claude-code or similar
      return { command: "claude-code", args: [task] };
    default:
      return { command: "cursor", args: ["agent", "run", "--task", task] };
  }
}
