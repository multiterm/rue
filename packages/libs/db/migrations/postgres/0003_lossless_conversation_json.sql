ALTER TABLE "sessions" ALTER COLUMN "scopes" SET DATA TYPE json;
--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "scopes" SET DEFAULT '[]'::json;
--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "meta" SET DATA TYPE json;
--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "meta" SET DEFAULT '{}'::json;
--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "meta" SET DATA TYPE json;
--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "meta" SET DEFAULT '{}'::json;
--> statement-breakpoint
ALTER TABLE "parts" ALTER COLUMN "payload" SET DATA TYPE json;
