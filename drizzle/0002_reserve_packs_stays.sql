CREATE TABLE "hospital_stays" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hospital_stays_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	CONSTRAINT "hospital_stays_order" CHECK ("hospital_stays"."end_date" >= "hospital_stays"."start_date")
);
--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "pack_unit" text DEFAULT '盒' NOT NULL;--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "per_box" numeric(7, 1);--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "reserve" numeric(10, 1) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "medications" ADD CONSTRAINT "medications_pack_unit" CHECK ("medications"."pack_unit" in ('盒', '瓶'));--> statement-breakpoint
ALTER TABLE "medications" ADD CONSTRAINT "medications_per_box_positive" CHECK ("medications"."per_box" > 0);--> statement-breakpoint
ALTER TABLE "medications" ADD CONSTRAINT "medications_per_box_half_step" CHECK (per_box * 2 = trunc(per_box * 2));--> statement-breakpoint
ALTER TABLE "medications" ADD CONSTRAINT "medications_reserve_non_negative" CHECK ("medications"."reserve" >= 0);--> statement-breakpoint
ALTER TABLE "medications" ADD CONSTRAINT "medications_reserve_half_step" CHECK (reserve * 2 = trunc(reserve * 2));