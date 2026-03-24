import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { agents, threads } from "../db/schema.js";
import {
  evaluateMessagePosting,
  evaluateThreadCreation,
  evaluateThreadStatusChange,
  normalizeThreadTaskType,
} from "./governance-policy.js";

async function setupDb() {
  const client = new PGlite();
  const db = drizzlePglite(client, { schema: { agents, threads } });
  await db.execute(sql`
    CREATE TABLE agents (
      id text PRIMARY KEY,
      name text NOT NULL,
      type text NOT NULL DEFAULT 'cursor',
      role text NOT NULL,
      is_lead boolean DEFAULT false,
      parent_id text,
      config text,
      hire_idempotency_key text,
      awake_enabled boolean NOT NULL DEFAULT true,
      awake_interval_minutes integer NOT NULL DEFAULT 30,
      last_awake_at timestamptz,
      next_awake_at timestamptz,
      created_at timestamptz DEFAULT now() NOT NULL,
      updated_at timestamptz DEFAULT now() NOT NULL
    );
  `);
  await db.execute(sql`
    CREATE TABLE threads (
      id text PRIMARY KEY,
      project_id text NOT NULL,
      agent_id text NOT NULL,
      title text,
      status text NOT NULL DEFAULT 'not_started',
      task_type text NOT NULL DEFAULT 'general',
      pending_owner_run boolean NOT NULL DEFAULT false,
      session_id text,
      created_at timestamptz DEFAULT now() NOT NULL
    );
  `);
  return {
    db,
    close: async () => client.close(),
  };
}

async function seedOrg(db: ReturnType<typeof drizzlePglite>) {
  await db.insert(agents).values([
    { id: "lead-1", name: "Lead", type: "cursor", role: "CEO", isLead: true, parentId: null },
    { id: "mgr-1", name: "CTO", type: "cursor", role: "CTO", isLead: false, parentId: "lead-1" },
    { id: "worker-1", name: "Eng", type: "cursor", role: "Engineer", isLead: false, parentId: "mgr-1" },
    { id: "outsider-1", name: "Other", type: "cursor", role: "Analyst", isLead: false, parentId: null },
  ]);
  await db.insert(threads).values([
    {
      id: "thread-1",
      projectId: "proj-1",
      agentId: "worker-1",
      title: "Implement feature",
      status: "in_progress",
      taskType: "technical",
    },
  ]);
}

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

test("evaluateThreadCreation rejects lead self-owned non-strategy thread", async () => {
  const { db, close } = await setupDb();
  try {
    await seedOrg(db);
    const decision = await evaluateThreadCreation(db as any, {
      requesterAgentId: "lead-1",
      ownerAgentId: "lead-1",
      taskType: "general",
      title: "Work item",
    });
    assert.equal(decision.allowed, false);
    if (!decision.allowed) assert.equal(decision.code, "must_delegate");
  } finally {
    await close();
  }
});

test("evaluateThreadCreation allows lead self-owned strategy thread", async () => {
  const { db, close } = await setupDb();
  try {
    await seedOrg(db);
    const decision = await evaluateThreadCreation(db as any, {
      requesterAgentId: "lead-1",
      ownerAgentId: "lead-1",
      taskType: "strategy",
      title: "Strategy",
    });
    assert.deepEqual(decision, { allowed: true });
  } finally {
    await close();
  }
});

test("evaluateMessagePosting allows manager review but blocks run status", async () => {
  const { db, close } = await setupDb();
  try {
    await seedOrg(db);
    const reviewDecision = await evaluateMessagePosting(db as any, {
      actorType: "agent",
      actorAgentId: "mgr-1",
      threadId: "thread-1",
      hasRunStatus: false,
    });
    assert.deepEqual(reviewDecision, { allowed: true });

    const runStatusDecision = await evaluateMessagePosting(db as any, {
      actorType: "agent",
      actorAgentId: "mgr-1",
      threadId: "thread-1",
      hasRunStatus: true,
    });
    assert.equal(runStatusDecision.allowed, false);
  } finally {
    await close();
  }
});

test("evaluateMessagePosting blocks unrelated agent", async () => {
  const { db, close } = await setupDb();
  try {
    await seedOrg(db);
    const decision = await evaluateMessagePosting(db as any, {
      actorType: "agent",
      actorAgentId: "outsider-1",
      threadId: "thread-1",
      hasRunStatus: false,
    });
    assert.equal(decision.allowed, false);
  } finally {
    await close();
  }
});

test("evaluateThreadStatusChange allows manager blocked override only", async () => {
  const { db, close } = await setupDb();
  try {
    await seedOrg(db);
    const blockedDecision = await evaluateThreadStatusChange(db as any, {
      actorType: "agent",
      requesterAgentId: "mgr-1",
      threadId: "thread-1",
      newStatus: "blocked",
    });
    assert.deepEqual(blockedDecision, { allowed: true });

    const completedDecision = await evaluateThreadStatusChange(db as any, {
      actorType: "agent",
      requesterAgentId: "mgr-1",
      threadId: "thread-1",
      newStatus: "completed",
    });
    assert.equal(completedDecision.allowed, false);
  } finally {
    await close();
  }
});
