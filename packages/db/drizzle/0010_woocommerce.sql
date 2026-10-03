CREATE TABLE "woo_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"options" jsonb NOT NULL,
	"created_by" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "woo_url" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "woo_consumer_key" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "woo_consumer_secret" text;--> statement-breakpoint
ALTER TABLE "woo_imports" ADD CONSTRAINT "woo_imports_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "woo_imports_shop_id_created_at_index" ON "woo_imports" USING btree ("shop_id","created_at");