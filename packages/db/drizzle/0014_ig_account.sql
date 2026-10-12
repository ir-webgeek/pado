ALTER TABLE "shops" ADD COLUMN "ig_connected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "ig_token_refreshed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "ig_webhook_subscribed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "ig_last_event_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "ig_profile" jsonb;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "ig_last_error" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "ig_last_error_at" timestamp with time zone;