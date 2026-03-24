import test from "node:test";
import assert from "node:assert/strict";
import { parseRunStatusToken, validateThreadMessageRunContract } from "./thread-message-contract.js";

test("rejects payload with runId but no runStatus", () => {
  const result = validateThreadMessageRunContract({
    actorType: "agent",
    runId: "run-1",
    runStatus: null,
  });

  assert.equal(result.ok, false);
  assert.equal(
    (result as { ok: false; error: string }).error,
    "runStatus is required when runId is provided"
  );
});

test("rejects payload with runStatus when actorType is board", () => {
  const result = validateThreadMessageRunContract({
    actorType: "board",
    runId: "run-1",
    runStatus: "started",
  });

  assert.equal(result.ok, false);
  assert.equal(
    (result as { ok: false; error: string }).error,
    "runStatus is only allowed when actorType is agent"
  );
});

test("rejects payload with runStatus but no runId", () => {
  const result = validateThreadMessageRunContract({
    actorType: "agent",
    runId: "",
    runStatus: "started",
  });

  assert.equal(result.ok, false);
  assert.equal(
    (result as { ok: false; error: string }).error,
    "runId is required when runStatus is provided"
  );
});

test("accepts valid agent payload with runId and runStatus", () => {
  const result = validateThreadMessageRunContract({
    actorType: "agent",
    runId: "run-1",
    runStatus: "in_progress",
  });

  assert.deepEqual(result, { ok: true });
});

test("parseRunStatusToken treats null like absent", () => {
  assert.equal(parseRunStatusToken(null), null);
});
