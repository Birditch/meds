CREATE TABLE "medication_packs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "medication_packs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"medication_id" integer NOT NULL,
	"brand" text,
	"pack_unit" text DEFAULT '盒' NOT NULL,
	"per_box" numeric(7, 1),
	"position" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "medication_packs_pack_unit" CHECK ("medication_packs"."pack_unit" in ('盒', '瓶')),
	CONSTRAINT "medication_packs_per_box_positive" CHECK ("medication_packs"."per_box" > 0),
	CONSTRAINT "medication_packs_per_box_half_step" CHECK (per_box * 2 = trunc(per_box * 2))
);
--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "supply_logs" ADD COLUMN "pack_id" integer;--> statement-breakpoint
ALTER TABLE "medication_packs" ADD CONSTRAINT "medication_packs_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."medications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "medication_packs_medication_idx" ON "medication_packs" USING btree ("medication_id","position");--> statement-breakpoint
ALTER TABLE "supply_logs" ADD CONSTRAINT "supply_logs_pack_id_medication_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."medication_packs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Every existing medication keeps its packaging as its default (first) pack.
INSERT INTO "medication_packs" ("medication_id", "brand", "pack_unit", "per_box", "position")
SELECT "id", "brand", "pack_unit", "per_box", 0 FROM "medications" ORDER BY "id";
