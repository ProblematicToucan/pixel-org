ALTER TABLE "agent_run_requests" ADD COLUMN IF NOT EXISTS "pid" integer;
--> statement-breakpoint
ALTER TABLE "agent_run_requests" ADD COLUMN IF NOT EXISTS "command" text;
--> statement-breakpoint
ALTER TABLE "agent_run_requests" ADD COLUMN IF NOT EXISTS "args" text;
--> statement-breakpoint
ALTER TABLE "agent_run_requests" ADD COLUMN IF NOT EXISTS "exit_code" integer;
--> statement-breakpoint
ALTER TABLE "agent_run_requests" ADD COLUMN IF NOT EXISTS "stdout" text;
--> statement-breakpoint
ALTER TABLE "agent_run_requests" ADD COLUMN IF NOT EXISTS "stderr" text;
--> statement-breakpoint
ALTER TABLE "agent_run_requests" ADD COLUMN IF NOT EXISTS "timed_out" boolean;
