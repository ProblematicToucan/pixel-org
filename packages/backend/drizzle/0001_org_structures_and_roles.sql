-- Org structures (company models)
CREATE TABLE `org_structures` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
  `updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);

-- Role definitions per structure (parent_slug null = top, e.g. CEO)
CREATE TABLE `org_roles` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `structure_id` integer NOT NULL REFERENCES org_structures(id),
  `slug` text NOT NULL,
  `name` text NOT NULL,
  `parent_slug` text,
  `allowed_actions` text,
  `sort_order` integer DEFAULT 0,
  `created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
  `updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);

-- Add org columns to agents
ALTER TABLE `agents` ADD COLUMN `org_role_slug` text;
ALTER TABLE `agents` ADD COLUMN `parent_id` integer REFERENCES agents(id);
ALTER TABLE `agents` ADD COLUMN `structure_id` integer REFERENCES org_structures(id);
