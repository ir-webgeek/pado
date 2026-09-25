ALTER TYPE "public"."plan_id" ADD VALUE 'free' BEFORE 'starter';--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"conversation_id" uuid,
	"channel" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost" bigint DEFAULT 0 NOT NULL,
	"tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"handoff" text,
	"reply" text,
	"error" text,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"rule_id" uuid,
	"conversation_id" uuid,
	"trigger" text NOT NULL,
	"input" text,
	"ok" boolean DEFAULT true NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"name" text NOT NULL,
	"trigger" text NOT NULL,
	"media_id" text,
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"match_mode" text DEFAULT 'contains' NOT NULL,
	"public_reply" text,
	"private_reply" text,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"then_mode" text DEFAULT 'keep' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"customer_id" uuid,
	"conversation_id" uuid,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"fields" jsonb NOT NULL,
	"success_message" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"submissions" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ig_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"media_id" text NOT NULL,
	"media_type" text NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"media_url" text,
	"thumbnail_url" text,
	"permalink" text,
	"child_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"posted_at" timestamp with time zone,
	"status" text DEFAULT 'new' NOT NULL,
	"extracted" jsonb,
	"product_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "comment_rules_shop_id_active_index";--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "refund_status" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "platform_fee" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "price_usd_cents" integer;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "landing" jsonb;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_super_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_events" ADD CONSTRAINT "automation_events_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_events" ADD CONSTRAINT "automation_events_rule_id_automation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ig_media" ADD CONSTRAINT "ig_media_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ig_media" ADD CONSTRAINT "ig_media_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_entries" ADD CONSTRAINT "knowledge_entries_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_shop_id_created_at_index" ON "agent_runs" USING btree ("shop_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_runs_created_at_index" ON "agent_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "automation_events_shop_id_created_at_index" ON "automation_events" USING btree ("shop_id","created_at");--> statement-breakpoint
CREATE INDEX "automation_rules_shop_id_trigger_active_index" ON "automation_rules" USING btree ("shop_id","trigger","active");--> statement-breakpoint
CREATE INDEX "form_submissions_form_id_created_at_index" ON "form_submissions" USING btree ("form_id","created_at");--> statement-breakpoint
CREATE INDEX "forms_shop_id_index" ON "forms" USING btree ("shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ig_media_shop_id_media_id_index" ON "ig_media" USING btree ("shop_id","media_id");--> statement-breakpoint
CREATE INDEX "ig_media_shop_id_status_index" ON "ig_media" USING btree ("shop_id","status");--> statement-breakpoint
CREATE INDEX "knowledge_entries_shop_id_active_index" ON "knowledge_entries" USING btree ("shop_id","active");--> statement-breakpoint
CREATE INDEX "knowledge_fts" ON "knowledge_entries" USING gin (to_tsvector('simple', "title" || ' ' || "content"));--> statement-breakpoint
CREATE INDEX "knowledge_trgm" ON "knowledge_entries" USING gin ("content" gin_trgm_ops);