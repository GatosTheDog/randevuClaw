CREATE TABLE "bookings" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"client_phone" text NOT NULL,
	"service_id" integer NOT NULL,
	"calendar_date" text NOT NULL,
	"calendar_time" text NOT NULL,
	"booking_status" text DEFAULT 'pending_owner_approval' NOT NULL,
	"request_id" text NOT NULL,
	"owner_telegram_message_id" integer,
	"rescheduled_from_booking_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "business_hours" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"day_of_week" integer NOT NULL,
	"open_time" text NOT NULL,
	"close_time" text NOT NULL,
	"is_closed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_turns" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"client_phone" text NOT NULL,
	"interaction_id" text,
	"request_id" text NOT NULL,
	"message_text" text NOT NULL,
	"response_text" text NOT NULL,
	"tool_calls" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"name" text NOT NULL,
	"duration_min" integer NOT NULL,
	"price" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_updates" (
	"id" serial PRIMARY KEY NOT NULL,
	"update_id" text NOT NULL,
	"business_id" integer,
	"sender_telegram_id" text NOT NULL,
	"update_type" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_updates_update_id_unique" UNIQUE("update_id")
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "owner_telegram_id" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_hours" ADD CONSTRAINT "business_hours_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_turns" ADD CONSTRAINT "conversation_turns_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_updates" ADD CONSTRAINT "telegram_updates_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "unique_active_slot_per_business" ON "bookings" USING btree ("business_id","calendar_date","calendar_time") WHERE booking_status IN ('pending_owner_approval', 'confirmed');--> statement-breakpoint
CREATE UNIQUE INDEX "unique_request_per_client" ON "bookings" USING btree ("client_phone","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_business_day" ON "business_hours" USING btree ("business_id","day_of_week");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_business_service" ON "services" USING btree ("business_id","name");