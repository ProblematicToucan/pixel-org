import test from "node:test";
import assert from "node:assert/strict";
import { normalizeThreadTaskType } from "./governance-policy.js";

test("normalizeThreadTaskType maps unknown values to general", () => {
  assert.equal(normalizeThreadTaskType(undefined), "general");
  assert.equal(normalizeThreadTaskType(""), "general");
  assert.equal(normalizeThreadTaskType("unknown"), "general");
});

test("normalizeThreadTaskType preserves allowed values", () => {
  assert.equal(normalizeThreadTaskType("technical"), "technical");
  assert.equal(normalizeThreadTaskType("operations"), "operations");
  assert.equal(normalizeThreadTaskType("finance"), "finance");
  assert.equal(normalizeThreadTaskType("strategy"), "strategy");
  assert.equal(normalizeThreadTaskType("general"), "general");
});

test("normalizeThreadTaskType handles case and whitespace", () => {
  assert.equal(normalizeThreadTaskType("  TECHNICAL "), "technical");
});
