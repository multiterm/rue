CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"role" text NOT NULL,
	"time" bigint NOT NULL,
	"provider" text,
	"model" text,
	"agent" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"seq" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parts" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"message_id" text NOT NULL,
	"type" text NOT NULL,
	"seq" integer NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"agent" text,
	"provider" text,
	"model" text,
	"directory" text,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"parent_id" text,
	"owner_subject" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_messages_session" ON "messages" USING btree ("session_id","seq");--> statement-breakpoint
CREATE INDEX "idx_parts_message" ON "parts" USING btree ("message_id","seq");--> statement-breakpoint
CREATE INDEX "idx_parts_session_seq" ON "parts" USING btree ("session_id","seq");--> statement-breakpoint
CREATE INDEX "idx_sessions_owner_updated" ON "sessions" USING btree ("owner_subject","updated_at","id");--> statement-breakpoint
CREATE INDEX "idx_sessions_parent" ON "sessions" USING btree ("parent_id");