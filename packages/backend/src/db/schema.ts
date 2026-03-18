import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { randomUUID } from "node:crypto";

/** UUID primary key for SQLite (no native UUID; store as text, generate in app). */
const uuid = () => text("id", { length: 36 }).primaryKey().$default(() => randomUUID());

/**
 * Agents = participants (like users). Can be recruited, registered, and interact in projects/threads.
 */
export const agents = sqliteTable("agents", {
  id: uuid(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  role: text("role").notNull(),
  isLead: integer("is_lead", { mode: "boolean" }).default(false),
  parentId: text("parent_id", { length: 36 }).references((): any => agents.id),
  config: text("config"),
  createdAt: text("created_at").default("CURRENT_TIMESTAMP").notNull(),
  updatedAt: text("updated_at").default("CURRENT_TIMESTAMP").notNull(),
});

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;

/** Project (like Slack channel / repo). Has many threads. */
export const projects = sqliteTable("projects", {
  id: uuid(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  createdAt: text("created_at").default("CURRENT_TIMESTAMP").notNull(),
});

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

/** Thread = one piece of work in a project. One agent owns; any agent can discuss. */
export const threads = sqliteTable("threads", {
  id: uuid(),
  projectId: text("project_id", { length: 36 })
    .notNull()
    .references(() => projects.id),
  agentId: text("agent_id", { length: 36 })
    .notNull()
    .references(() => agents.id),
  title: text("title"),
  createdAt: text("created_at").default("CURRENT_TIMESTAMP").notNull(),
});

export type Thread = typeof threads.$inferSelect;
export type NewThread = typeof threads.$inferInsert;

/** Message = one reply in a thread. Any agent can post. */
export const messages = sqliteTable("messages", {
  id: uuid(),
  threadId: text("thread_id", { length: 36 })
    .notNull()
    .references(() => threads.id),
  agentId: text("agent_id", { length: 36 })
    .notNull()
    .references(() => agents.id),
  content: text("content").notNull(),
  createdAt: text("created_at").default("CURRENT_TIMESTAMP").notNull(),
});

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
