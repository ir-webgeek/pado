CREATE TABLE "customer_wallet_tx" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"reason" text NOT NULL,
	"ref_type" text,
	"ref_id" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "wallet_balance" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_wallet_tx" ADD CONSTRAINT "customer_wallet_tx_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_wallet_tx" ADD CONSTRAINT "customer_wallet_tx_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_wallet_tx_customer_id_created_at_index" ON "customer_wallet_tx" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "customer_wallet_tx_shop_id_created_at_index" ON "customer_wallet_tx" USING btree ("shop_id","created_at");--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customer_wallet_non_negative" CHECK ("customers"."wallet_balance" >= 0);