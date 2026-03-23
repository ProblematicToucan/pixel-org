export type DeliveryContractFailureReason =
  | "missing_agent_thread_update"
  | "missing_terminal_status_update";

export type StructuredRunStatus = "started" | "in_progress" | "completed";

export type StructuredRunEvent = {
  runId: string | null;
  runStatus: StructuredRunStatus | null;
  actorType: "agent" | "board";
  agentId: string | null;
  createdAt: string | Date;
};

function isTerminalStatusToken(status: StructuredRunStatus | null): boolean {
  return status === "completed";
}

export function normalizeDeliveryContractReason(reason: DeliveryContractFailureReason): string {
  return `contract_failure:${reason}`;
}

export function evaluateRunDeliveryContract(params: {
  runId: string;
  runEvents: StructuredRunEvent[];
  ownerAgentId: string;
  requireTerminalStatus: boolean;
}): { passed: true } | { passed: false; reason: DeliveryContractFailureReason } {
  const ownerUpdates = params.runEvents.filter((event) => {
    if (event.runId !== params.runId) return false;
    if (event.actorType !== "agent" || event.agentId !== params.ownerAgentId) return false;
    return event.runStatus != null;
  });

  if (ownerUpdates.length === 0) {
    return { passed: false, reason: "missing_agent_thread_update" };
  }

  if (params.requireTerminalStatus) {
    const hasTerminal = ownerUpdates.some((event) => isTerminalStatusToken(event.runStatus));
    if (!hasTerminal) {
      return { passed: false, reason: "missing_terminal_status_update" };
    }
  }

  return { passed: true };
}
