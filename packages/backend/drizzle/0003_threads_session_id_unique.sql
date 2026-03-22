CREATE UNIQUE INDEX IF NOT EXISTS "threads_session_id_unique" ON "threads" ("session_id") WHERE "session_id" IS NOT NULL;
