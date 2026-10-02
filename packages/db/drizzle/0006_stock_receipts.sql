CREATE TABLE "stock_receipt_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_cost" bigint NOT NULL,
	CONSTRAINT "receipt_qty_positive" CHECK ("stock_receipt_items"."quantity" > 0),
	CONSTRAINT "receipt_cost_non_negative" CHECK ("stock_receipt_items"."unit_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"code" text NOT NULL,
	"supplier" text DEFAULT '' NOT NULL,
	"note" text,
	"received_at" timestamp with time zone NOT NULL,
	"total" bigint NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "unit_cost" bigint;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "cost_price" bigint;--> statement-breakpoint
ALTER TABLE "stock_receipt_items" ADD CONSTRAINT "stock_receipt_items_receipt_id_stock_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."stock_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receipt_items" ADD CONSTRAINT "stock_receipt_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_receipt_items_receipt_id_index" ON "stock_receipt_items" USING btree ("receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_receipts_shop_id_code_index" ON "stock_receipts" USING btree ("shop_id","code");--> statement-breakpoint
CREATE INDEX "stock_receipts_shop_id_received_at_index" ON "stock_receipts" USING btree ("shop_id","received_at");