-- Projects, threads, messages: all ids UUID (text)
CREATE TABLE `projects` (
  `id` text(36) PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `slug` text NOT NULL,
  `created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);

CREATE TABLE `threads` (
  `id` text(36) PRIMARY KEY NOT NULL,
  `project_id` text(36) NOT NULL REFERENCES projects(id),
  `agent_id` text(36) NOT NULL REFERENCES agents(id),
  `title` text,
  `created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);

CREATE TABLE `messages` (
  `id` text(36) PRIMARY KEY NOT NULL,
  `thread_id` text(36) NOT NULL REFERENCES threads(id),
  `agent_id` text(36) NOT NULL REFERENCES agents(id),
  `content` text NOT NULL,
  `created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);
