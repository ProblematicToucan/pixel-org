-- Lead’s judgment on a report’s work (e.g. CTO reviews Engineer’s project)
CREATE TABLE `reviews` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `reviewer_agent_id` integer NOT NULL REFERENCES agents(id),
  `subject_agent_id` integer NOT NULL REFERENCES agents(id),
  `project_id` text NOT NULL,
  `status` text NOT NULL,
  `comment` text,
  `created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);
