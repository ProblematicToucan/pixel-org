import { sql } from "drizzle-orm";
import { index, pgTable, text, boolean, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { randomUUID } from "node:crypto";

/** UUID primary key for SQLite (no native UUID; store as text, generate in app). */
const uuid = () => text("id").primaryKey().$defaultFn(() => randomUUID());

/**
 * Agents = participants (like users). Can be recruited, registered, and interact in projects/threads.
 */
export const agents = pgTable("agents", {
  id: uuid(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  role: text("role").notNull(),
  isLead: boolean("is_lead").default(false),
  parentId: text("parent_id").references((): any => agents.id),
  config: text("config"),
  awakeEnabled: boolean("awake_enabled").default(true).notNull(),
  awakeIntervalMinutes: integer("awake_interval_minutes").default(30).notNull(),
  lastAwakeAt: timestamp("last_awake_at", { withTimezone: true }),
  nextAwakeAt: timestamp("next_awake_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;

/** Project (like Slack channel / repo). Has many threads. Goals = user-defined objectives (Option B). */
export const projects = pgTable("projects", {
  id: uuid(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  goals: text("goals"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

/** Thread = one piece of work in a project. One agent owns; any agent can discuss. */
export const threads = pgTable("threads", {
  id: uuid(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  agentId: text("agent_id")
    .notNull()
    .references(() => agents.id),
  title: text("title"),
  status: text("status")
    .notNull()
    .default("not_started")
    .$type<"not_started" | "in_progress" | "completed" | "blocked" | "cancelled">(),
  pendingOwnerRun: boolean("pending_owner_run").default(false).notNull(),
  /** Headless agent CLI session id for resume (one per Pixel thread; provider-specific opaque string). */
  sessionId: text("session_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  threadsSessionIdUnique: uniqueIndex("threads_session_id_unique")
    .on(table.sessionId)
    .where(sql`${table.sessionId} is not null`),
  /** At most one canonical Board kickoff thread per project (normalized title). */
  threadsBoardKickoffUnique: uniqueIndex("threads_board_kickoff_unique")
    .on(table.projectId)
    .where(sql`lower(trim(coalesce(${table.title}, ''))) = 'board kickoff'`),
}));

export type Thread = typeof threads.$inferSelect;
export type NewThread = typeof threads.$inferInsert;

/** Message = one reply in a thread. Sender can be an agent or Board. */
export const messages = pgTable("messages", {
  id: uuid(),
  threadId: text("thread_id")
    .notNull()
    .references(() => threads.id),
  agentId: text("agent_id").references(() => agents.id),
  actorType: text("actor_type").notNull().default("agent"),
  actorName: text("actor_name"),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

/**
 * Durable approval workflow: requester asks approver (typically direct manager) to sign off.
 * Source of truth for pending/resolved; thread messages mirror for humans.
 */
export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: uuid(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    sourceThreadId: text("source_thread_id")
      .notNull()
      .references(() => threads.id),
    requesterAgentId: text("requester_agent_id")
      .notNull()
      .references(() => agents.id),
    approverAgentId: text("approver_agent_id")
      .notNull()
      .references(() => agents.id),
    summary: text("summary").notNull(),
    status: text("status")
      .notNull()
      .default("pending")
      .$type<"pending" | "approved" | "rejected" | "cancelled">(),
    resolutionNote: text("resolution_note"),
    /** Optional JSON string for risk tier, links, etc. */
    metadata: text("metadata"),
    /** Client-supplied dedupe key; one pending request per key per requester+thread optional uniqueness enforced in app. */
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => ({
    approvalRequestsIdempotencyUnique: uniqueIndex("approval_requests_idempotency_unique").on(
      table.requesterAgentId,
      table.sourceThreadId,
      table.idempotencyKey
    ),
    approvalRequestsApproverStatusCreatedAtIdx: index("approval_requests_approver_status_created_at_idx").on(
      table.approverAgentId,
      table.status,
      table.createdAt
    ),
    approvalRequestsRequesterStatusCreatedAtIdx: index("approval_requests_requester_status_created_at_idx").on(
      table.requesterAgentId,
      table.status,
      table.createdAt
    ),
  })
);

export type ApprovalRequest = typeof approvalRequests.$inferSelect;
export type NewApprovalRequest = typeof approvalRequests.$inferInsert;

/** Agent run requests (kickoff/scheduler orchestration with idempotency + status). */
export const agentRunRequests = pgTable(
  "agent_run_requests",
  {
    id: uuid(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    reason: text("reason").notNull(),
    /** When reason is approval_pending, links to the row being acted on. */
    approvalRequestId: text("approval_request_id").references(() => approvalRequests.id),
    model: text("model").notNull().default("auto"),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("queued"),
    pid: integer("pid"),
    command: text("command"),
    args: text("args"),
    exitCode: integer("exit_code"),
    stdout: text("stdout"),
    stderr: text("stderr"),
    timedOut: boolean("timed_out"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    agentRunRequestsIdempotencyKeyUnique: uniqueIndex("agent_run_requests_idempotency_key_unique").on(
      table.idempotencyKey
    ),
  })
);

export type AgentRunRequest = typeof agentRunRequests.$inferSelect;
export type NewAgentRunRequest = typeof agentRunRequests.$inferInsert;
