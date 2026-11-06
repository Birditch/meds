CREATE TABLE "dosage_regimens" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "dosage_regimens_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"medication_id" integer NOT NULL,
	"effective_from" date NOT NULL,
	"morning" numeric(6, 1) DEFAULT 0 NOT NULL,
	"noon" numeric(6, 1) DEFAULT 0 NOT NULL,
	"evening" numeric(6, 1) DEFAULT 0 NOT NULL,
	CONSTRAINT "dosage_regimens_medication_effective_from_key" UNIQUE("medication_id","effective_from"),
	CONSTRAINT "dosage_regimens_non_negative" CHECK ("dosage_regimens"."morning" >= 0 and "dosage_regimens"."noon" >= 0 and "dosage_regimens"."evening" >= 0),
	CONSTRAINT "dosage_regimens_half_step" CHECK (morning * 2 = trunc(morning * 2) and noon * 2 = trunc(noon * 2) and evening * 2 = trunc(evening * 2))
);
--> statement-breakpoint
CREATE TABLE "medications" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "medications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"brand" text,
	"dosage" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supply_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "supply_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"medication_id" integer NOT NULL,
	"date" date NOT NULL,
	"quantity" numeric(10, 1) NOT NULL,
	CONSTRAINT "supply_logs_quantity_positive" CHECK ("supply_logs"."quantity" > 0),
	CONSTRAINT "supply_logs_quantity_half_step" CHECK (quantity * 2 = trunc(quantity * 2))
);
--> statement-breakpoint
ALTER TABLE "dosage_regimens" ADD CONSTRAINT "dosage_regimens_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."medications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_logs" ADD CONSTRAINT "supply_logs_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."medications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supply_logs_medication_date_idx" ON "supply_logs" USING btree ("medication_id","date");