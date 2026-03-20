ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "awake_enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "awake_interval_minutes" integer DEFAULT 30 NOT NULL;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "last_awake_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "next_awake_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_run_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL,
  "thread_id" text NOT NULL,
  "agent_id" text NOT NULL,
  "reason" text NOT NULL,
  "model" text DEFAULT 'auto' NOT NULL,
  "idempotency_key" text NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "error" text,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_run_requests_idempotency_key_unique"
  ON "agent_run_requests" ("idempotency_key");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_run_requests" ADD CONSTRAINT "agent_run_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_run_requests" ADD CONSTRAINT "agent_run_requests_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_run_requests" ADD CONSTRAINT "agent_run_requests_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
