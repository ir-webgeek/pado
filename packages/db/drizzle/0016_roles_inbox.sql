CREATE TABLE "conversation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_id" uuid,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"name" text NOT NULL,
	"permissions" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "status" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "assignee_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop_members" ADD COLUMN "custom_role_id" uuid;--> statement-breakpoint
ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_roles" ADD CONSTRAINT "shop_roles_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_events_conversation_id_created_at_index" ON "conversation_events" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "shop_roles_shop_id_index" ON "shop_roles" USING btree ("shop_id");--> statement-breakpoint
-- existing flagged chats start in the pipeline where they are
UPDATE "conversations" SET "status" = 'needs_human' WHERE "needs_human" = true;--> statement-breakpoint
CREATE INDEX "conversations_shop_id_status_index" ON "conversations" USING btree ("shop_id", "status");
