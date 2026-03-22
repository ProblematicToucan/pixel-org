import { spawn } from "node:child_process";

const UUID_LINE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_CREATE_SESSION_TIMEOUT_MS = 30_000;

export interface CreateCliSessionOptions {
  /** Agent home directory (same as `runAgent` cwd). */
  cwd: string;
  /** Max time to wait for the CLI to exit (default 30s). */
  timeoutMs?: number;
}

/**
 * Provisions a new headless CLI session and returns its id for `resumeSessionId` / `--resume`.
 * Current implementation (Cursor Agent): `agent --workspace <cwd> create-chat`.
 */
export async function createCliSession(options: CreateCliSessionOptions): Promise<string> {
  const { cwd, timeoutMs = DEFAULT_CREATE_SESSION_TIMEOUT_MS } = options;
  return new Promise((resolve, reject) => {
    const proc = spawn("agent", ["--workspace", cwd, "create-chat"], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            if (settled) return;
            settled = true;
            proc.removeAllListeners();
            proc.kill("SIGTERM");
            reject(new Error(`create-chat timed out after ${timeoutMs}ms`));
          }, timeoutMs)
        : undefined;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };

    proc.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    proc.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    proc.on("close", (code) => {
      finish(() => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `create-chat exited with code ${code ?? "unknown"}`));
          return;
        }
        const line = stdout
          .trim()
          .split(/\r?\n/)
          .map((l) => l.trim())
          .find((l) => UUID_LINE.test(l));
        if (!line) {
          reject(new Error(`CLI did not return a session id (stdout: ${JSON.stringify(stdout)})`));
          return;
        }
        resolve(line);
      });
    });
    proc.on("error", (err) => {
      finish(() => {
        reject(err);
      });
    });
  });
}
