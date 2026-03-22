CREATE UNIQUE INDEX IF NOT EXISTS "threads_board_kickoff_unique" ON "threads" ("project_id") WHERE lower(trim(coalesce(title, ''))) = 'board kickoff';
