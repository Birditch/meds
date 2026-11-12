CREATE TABLE "missed_doses" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "missed_doses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"medication_id" integer NOT NULL,
	"date" date NOT NULL,
	"slot" text NOT NULL,
	"quantity" numeric(6, 1) NOT NULL,
	"kept" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "missed_doses_medication_date_slot_key" UNIQUE("medication_id","date","slot"),
	CONSTRAINT "missed_doses_slot" CHECK ("missed_doses"."slot" in ('morning', 'noon', 'evening')),
	CONSTRAINT "missed_doses_kept" CHECK ("missed_doses"."kept" in ('stock', 'reserve', 'none')),
	CONSTRAINT "missed_doses_quantity_positive" CHECK ("missed_doses"."quantity" > 0),
	CONSTRAINT "missed_doses_quantity_half_step" CHECK (quantity * 2 = trunc(quantity * 2))
);
--> statement-breakpoint
ALTER TABLE "reserve_logs" DROP CONSTRAINT "reserve_logs_kind";--> statement-breakpoint
ALTER TABLE "reserve_logs" ADD COLUMN "missed_dose_id" integer;--> statement-breakpoint
ALTER TABLE "reserve_logs" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "reserve_logs" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "missed_doses" ADD CONSTRAINT "missed_doses_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."medications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserve_logs" ADD CONSTRAINT "reserve_logs_missed_dose_id_missed_doses_id_fk" FOREIGN KEY ("missed_dose_id") REFERENCES "public"."missed_doses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserve_logs" ADD CONSTRAINT "reserve_logs_reason" CHECK ("reserve_logs"."reason" is null or "reserve_logs"."reason" in ('extra', 'carry', 'expired', 'damaged', 'lost', 'given', 'returned', 'other'));--> statement-breakpoint
ALTER TABLE "reserve_logs" ADD CONSTRAINT "reserve_logs_kind" CHECK ("reserve_logs"."kind" in ('restock', 'draw', 'count', 'transfer', 'use', 'missed'));