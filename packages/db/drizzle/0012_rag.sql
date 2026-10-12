CREATE TABLE "ig_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"comment_id" text NOT NULL,
	"media_id" text,
	"parent_id" text,
	"from_id" text,
	"username" text,
	"text" text NOT NULL,
	"by_shop" boolean DEFAULT false NOT NULL,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_entries" ADD COLUMN "ref" text;--> statement-breakpoint
ALTER TABLE "ig_comments" ADD CONSTRAINT "ig_comments_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ig_comments_shop_id_comment_id_index" ON "ig_comments" USING btree ("shop_id","comment_id");--> statement-breakpoint
CREATE INDEX "ig_comments_shop_id_media_id_index" ON "ig_comments" USING btree ("shop_id","media_id");