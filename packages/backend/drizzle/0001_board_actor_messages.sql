ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "actor_type" text DEFAULT 'agent' NOT NULL;
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "actor_name" text;
--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "agent_id" DROP NOT NULL;
--> statement-breakpoint
UPDATE "messages"
SET "actor_type" = 'agent'
WHERE "actor_type" IS NULL;
