import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/** Org model (e.g. "Standard company", "Startup"). Defines which roles exist and hierarchy. */
export const orgStructures = sqliteTable("org_structures", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: text("created_at").default("CURRENT_TIMESTAMP").notNull(),
  updatedAt: text("updated_at").default("CURRENT_TIMESTAMP").notNull(),
});

/** Role definition within an org structure. Names and slugs are user-defined. parent_slug = null means top. */
export const orgRoles = sqliteTable("org_roles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  structureId: integer("structure_id")
    .notNull()
    .references(() => orgStructures.id),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  parentSlug: text("parent_slug"),
  /** If 1, this role can recruit (create) new agents in the org. */
  canRecruit: integer("can_recruit", { mode: "boolean" }).default(false),
  allowedActions: text("allowed_actions"), // JSON: read, write, delete, approve, etc.
  sortOrder: integer("sort_order").default(0),
  createdAt: text("created_at").default("CURRENT_TIMESTAMP").notNull(),
  updatedAt: text("updated_at").default("CURRENT_TIMESTAMP").notNull(),
});

export type OrgStructure = typeof orgStructures.$inferSelect;
export type NewOrgStructure = typeof orgStructures.$inferInsert;
export type OrgRole = typeof orgRoles.$inferSelect;
export type NewOrgRole = typeof orgRoles.$inferInsert;

/** Agent instance: assigned to a user-defined org role and optionally reports to a parent agent. */
export const agents = sqliteTable("agents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type").notNull(),
  /** Org role slug for this agent (user-defined in org_roles). */
  orgRoleSlug: text("org_role_slug"),
  /** Parent agent id in the org tree (null = top). */
  /** Parent agent id in the org tree (null = top). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parentId: integer("parent_id").references((): any => agents),
  structureId: integer("structure_id").references(() => orgStructures.id),
  config: text("config"),
  createdAt: text("created_at").default("CURRENT_TIMESTAMP").notNull(),
  updatedAt: text("updated_at").default("CURRENT_TIMESTAMP").notNull(),
});

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
