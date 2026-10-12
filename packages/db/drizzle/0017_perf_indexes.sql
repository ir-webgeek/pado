CREATE INDEX "appointments_shop_completed_at" ON "appointments" USING btree ("shop_id","completed_at") WHERE "appointments"."status" = 'completed';--> statement-breakpoint
CREATE INDEX "appointments_conversation" ON "appointments" USING btree ("conversation_id") WHERE "appointments"."conversation_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "customers_name_fa_trgm" ON "customers" USING gin (lower(translate("name", 'يىكۀ‌‍۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', 'ییکه  01234567890123456789')) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "orders_shop_paid_at" ON "orders" USING btree ("shop_id","paid_at") WHERE "orders"."payment_status" = 'paid';--> statement-breakpoint
CREATE INDEX "orders_conversation" ON "orders" USING btree ("conversation_id") WHERE "orders"."conversation_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "products_title_fa_trgm" ON "products" USING gin (lower(translate("title", 'يىكۀ‌‍۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', 'ییکه  01234567890123456789')) gin_trgm_ops);