CREATE TABLE "stock_pools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "stock_pool_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_pools" ADD CONSTRAINT "stock_pools_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_pools_shop_id_index" ON "stock_pools" USING btree ("shop_id");--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_stock_pool_id_stock_pools_id_fk" FOREIGN KEY ("stock_pool_id") REFERENCES "public"."stock_pools"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_variants_stock_pool_id_index" ON "product_variants" USING btree ("stock_pool_id");--> statement-breakpoint
-- keep every member of a stock pool at the same stock/reserved: a change on one row is copied to its
-- siblings (depth guard stops the copies from triggering again)
CREATE OR REPLACE FUNCTION sync_stock_pool() RETURNS trigger AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  IF NEW.stock_pool_id IS NOT NULL AND (NEW.stock IS DISTINCT FROM OLD.stock OR NEW.reserved IS DISTINCT FROM OLD.reserved) THEN
    UPDATE product_variants SET stock = NEW.stock, reserved = NEW.reserved
    WHERE stock_pool_id = NEW.stock_pool_id AND id <> NEW.id;
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER product_variants_stock_pool AFTER UPDATE OF stock, reserved ON product_variants FOR EACH ROW EXECUTE FUNCTION sync_stock_pool();
