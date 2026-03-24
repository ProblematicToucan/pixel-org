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

test("fails when owner agent has no in_progress for run", () => {
  const result = evaluateRunDeliveryContract({
    runId: "run-1",
    runEvents: [],
    ownerAgentId: "agent-1",
    requireTerminalStatus: true,
  });

  assert.equal(result.passed, false);
  assert.equal(
    (result as { reason: DeliveryContractFailureReason }).reason,
    "missing_in_progress_update"
  );
});

test("fails when terminal status is required but only in_progress exists", () => {
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

test("fails when only orchestrator-seeded started exists", () => {
  const result = evaluateRunDeliveryContract({
    runId: "run-1",
    runEvents: [event("started")],
    ownerAgentId: "agent-1",
    requireTerminalStatus: true,
  });

  assert.equal(result.passed, false);
  assert.equal(
    (result as { reason: DeliveryContractFailureReason }).reason,
    "missing_in_progress_update"
  );
});

test("fails when only completed without in_progress", () => {
  const result = evaluateRunDeliveryContract({
    runId: "run-1",
    runEvents: [event("completed")],
    ownerAgentId: "agent-1",
    requireTerminalStatus: true,
  });

  assert.equal(result.passed, false);
  assert.equal(
    (result as { reason: DeliveryContractFailureReason }).reason,
    "missing_in_progress_update"
  );
});

test("passes when run has in_progress and completed", () => {
  const result = evaluateRunDeliveryContract({
    runId: "run-1",
    runEvents: [event("started"), event("in_progress"), event("completed")],
    ownerAgentId: "agent-1",
    requireTerminalStatus: true,
  });

  assert.deepEqual(result, { passed: true });
});

test("passes with in_progress and completed when no started row", () => {
  const result = evaluateRunDeliveryContract({
    runId: "run-1",
    runEvents: [event("in_progress"), event("completed")],
    ownerAgentId: "agent-1",
    requireTerminalStatus: true,
  });

  assert.deepEqual(result, { passed: true });
});

test("ignores events from other runs and agents", () => {
  const result = evaluateRunDeliveryContract({
    runId: "run-1",
    runEvents: [
      { ...event("in_progress"), runId: "run-2" },
      { ...event("completed"), agentId: "agent-2" },
      event("in_progress"),
      event("completed"),
    ],
    ownerAgentId: "agent-1",
    requireTerminalStatus: true,
  });

  assert.deepEqual(result, { passed: true });
});
