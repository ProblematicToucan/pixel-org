import type { ThreadStatus } from "./api";

export const THREAD_STATUS_OPTIONS: { value: ThreadStatus; label: string }[] = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "blocked", label: "Blocked" },
  { value: "cancelled", label: "Cancelled" },
];

export function formatThreadStatus(s: string | undefined | null): string {
  if (s == null || s === "") return "—";
  const found = THREAD_STATUS_OPTIONS.find((o) => o.value === s);
  return found?.label ?? s;
}

export function normalizeThreadStatus(s: string | undefined | null): ThreadStatus {
  const valid = THREAD_STATUS_OPTIONS.some((o) => o.value === s);
  return valid ? (s as ThreadStatus) : "not_started";
}
