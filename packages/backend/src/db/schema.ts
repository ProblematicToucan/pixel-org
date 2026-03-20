import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";
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
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Thread = typeof threads.$inferSelect;
export type NewThread = typeof threads.$inferInsert;

/** Message = one reply in a thread. Any agent can post. */
export const messages = pgTable("messages", {
  id: uuid(),
  threadId: text("thread_id")
    .notNull()
    .references(() => threads.id),
  agentId: text("agent_id")
    .notNull()
    .references(() => agents.id),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
