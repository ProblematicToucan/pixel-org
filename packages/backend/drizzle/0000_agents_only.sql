-- Agents: id is UUID (text), parent_id references agent id
CREATE TABLE `agents` (
  `id` text(36) PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `type` text NOT NULL,
  `role` text NOT NULL,
  `is_lead` integer DEFAULT 0,
  `parent_id` text(36) REFERENCES agents(id),
  `config` text,
  `created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
  `updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);
