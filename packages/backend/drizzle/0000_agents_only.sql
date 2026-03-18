-- Single table: agent metadata only
CREATE TABLE `agents` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `type` text NOT NULL,
  `role` text NOT NULL,
  `is_lead` integer DEFAULT 0,
  `parent_id` integer REFERENCES agents(id),
  `config` text,
  `created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
  `updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);
