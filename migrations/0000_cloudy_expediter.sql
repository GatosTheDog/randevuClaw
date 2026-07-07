CREATE TABLE "businesses" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"phone_number_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "businesses_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "client_business_relationships" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"sender_phone" text NOT NULL,
	"consent_given" boolean DEFAULT true NOT NULL,
	"consent_timestamp" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"whatsapp_message_id" text NOT NULL,
	"business_id" integer NOT NULL,
	"sender_phone" text NOT NULL,
	"message_body" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "messages_whatsapp_message_id_unique" UNIQUE("whatsapp_message_id")
);
--> statement-breakpoint
ALTER TABLE "client_business_relationships" ADD CONSTRAINT "client_business_relationships_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "unique_client_business" ON "client_business_relationships" USING btree ("business_id","sender_phone");