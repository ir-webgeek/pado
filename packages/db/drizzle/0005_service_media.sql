ALTER TABLE "services" ADD COLUMN "banner" text;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "gallery" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "before_after" jsonb DEFAULT '[]'::jsonb NOT NULL;