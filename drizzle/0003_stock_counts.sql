CREATE TABLE "stock_counts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stock_counts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"medication_id" integer NOT NULL,
	"date" date NOT NULL,
	"slots_done" smallint NOT NULL,
	"quantity" numeric(10, 1) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_counts_medication_date_key" UNIQUE("medication_id","date"),
	CONSTRAINT "stock_counts_slots_done" CHECK ("stock_counts"."slots_done" between 0 and 3),
	CONSTRAINT "stock_counts_quantity_non_negative" CHECK ("stock_counts"."quantity" >= 0),
	CONSTRAINT "stock_counts_quantity_half_step" CHECK (quantity * 2 = trunc(quantity * 2))
);
--> statement-breakpoint
ALTER TABLE "supply_logs" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."medications"("id") ON DELETE cascade ON UPDATE no action;