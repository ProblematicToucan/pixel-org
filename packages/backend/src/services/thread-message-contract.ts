export type RunStatusToken = "started" | "in_progress" | "completed";

export function parseRunStatusToken(value: unknown): RunStatusToken | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "started" || normalized === "in_progress" || normalized === "completed") {
    return normalized;
  }
  return null;
}

export function normalizeRunId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function validateThreadMessageRunContract(params: {
  actorType: "agent" | "board";
  runId: string;
  runStatus: RunStatusToken | null;
}): { ok: true } | { ok: false; error: string } {
  const hasRunId = params.runId.length > 0;
  const hasRunStatus = params.runStatus != null;

  if (hasRunId && !hasRunStatus) {
    return { ok: false, error: "runStatus is required when runId is provided" };
  }
  if (hasRunStatus && !hasRunId) {
    return { ok: false, error: "runId is required when runStatus is provided" };
  }
  if (hasRunStatus && params.actorType !== "agent") {
    return { ok: false, error: "runStatus is only allowed when actorType is agent" };
  }
  return { ok: true };
}
