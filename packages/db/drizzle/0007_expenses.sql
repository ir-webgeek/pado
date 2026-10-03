CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"category" text NOT NULL,
	"amount" bigint NOT NULL,
	"spent_at" timestamp with time zone NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_positive" CHECK ("expenses"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_shop_id_spent_at_index" ON "expenses" USING btree ("shop_id","spent_at");