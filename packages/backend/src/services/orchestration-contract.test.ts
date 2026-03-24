import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateRunDeliveryContract,
  type DeliveryContractFailureReason,
  type StructuredRunEvent,
} from "./orchestration-contract.js";

function event(status: StructuredRunEvent["runStatus"]): StructuredRunEvent {
  return {
    runId: "run-1",
    runStatus: status,
    actorType: "agent",
    agentId: "agent-1",
    createdAt: new Date().toISOString(),
  };
}

test("fails when owner agent has no structured event in run", () => {
  const result = evaluateRunDeliveryContract({
    runId: "run-1",
    runEvents: [],
    ownerAgentId: "agent-1",
    requireTerminalStatus: true,
  });

  assert.equal(result.passed, false);
  assert.equal(
    (result as { reason: DeliveryContractFailureReason }).reason,
    "missing_agent_thread_update"
  );
});

test("fails when terminal status is required but only non-terminal updates exist", () => {
  const result = evaluateRunDeliveryContract({
    runId: "run-1",
    runEvents: [event("started"), event("in_progress")],
    ownerAgentId: "agent-1",
    requireTerminalStatus: true,
  });

  assert.equal(result.passed, false);
  assert.equal(
    (result as { reason: DeliveryContractFailureReason }).reason,
    "missing_terminal_status_update"
  );
});

test("fails when only orchestrator-seeded started exists (no in_progress or completed from agent)", () => {
  const result = evaluateRunDeliveryContract({
    runId: "run-1",
    runEvents: [event("started")],
    ownerAgentId: "agent-1",
    requireTerminalStatus: true,
  });

  assert.equal(result.passed, false);
  assert.equal(
    (result as { reason: DeliveryContractFailureReason }).reason,
    "missing_agent_thread_update"
  );
});

test("passes when run has owner update and completed terminal status", () => {
  const result = evaluateRunDeliveryContract({
    runId: "run-1",
    runEvents: [event("started"), event("in_progress"), event("completed")],
    ownerAgentId: "agent-1",
    requireTerminalStatus: true,
  });

  assert.deepEqual(result, { passed: true });
});

test("passes with only completed when no-op path (no started/in_progress)", () => {
  const result = evaluateRunDeliveryContract({
    runId: "run-1",
    runEvents: [event("completed")],
    ownerAgentId: "agent-1",
    requireTerminalStatus: true,
  });

  assert.deepEqual(result, { passed: true });
});

test("ignores events from other runs and agents", () => {
  const result = evaluateRunDeliveryContract({
    runId: "run-1",
    runEvents: [
      { ...event("completed"), runId: "run-2" },
      { ...event("completed"), agentId: "agent-2" },
      event("completed"),
    ],
    ownerAgentId: "agent-1",
    requireTerminalStatus: true,
  });

  assert.deepEqual(result, { passed: true });
});
