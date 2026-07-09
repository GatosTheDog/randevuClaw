ALTER TABLE "bookings" ADD COLUMN "calendar_sync_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "google_calendar_event_id" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "calendar_sync_retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "reminder_24h_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "reminder_1h_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "google_refresh_token" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "agenda_sent_date" text;