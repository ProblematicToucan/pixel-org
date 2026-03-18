import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * Single table: agent metadata only. Role is an agnostic string (CEO, engineer, marketing, etc.).
 * Lead agents (is_lead) communicate with user, report on members, recruit.
 */
export const agents = sqliteTable("agents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type").notNull(),
  role: text("role").notNull(),
  isLead: integer("is_lead", { mode: "boolean" }).default(false),
  parentId: integer("parent_id").references((): any => agents),
  config: text("config"),
  createdAt: text("created_at").default("CURRENT_TIMESTAMP").notNull(),
  updatedAt: text("updated_at").default("CURRENT_TIMESTAMP").notNull(),
});

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;

/** Lead’s judgment on a report’s work (e.g. CTO reviews Engineer’s project). */
export const reviews = sqliteTable("reviews", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reviewerAgentId: integer("reviewer_agent_id")
    .notNull()
    .references(() => agents.id),
  subjectAgentId: integer("subject_agent_id")
    .notNull()
    .references(() => agents.id),
  projectId: text("project_id").notNull(),
  status: text("status").notNull(), // pending | approved | rejected
  comment: text("comment"),
  createdAt: text("created_at").default("CURRENT_TIMESTAMP").notNull(),
});

export type Review = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;
