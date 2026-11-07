ALTER TABLE "stock_counts" DROP CONSTRAINT "stock_counts_medication_date_key";--> statement-breakpoint
ALTER TABLE "medication_packs" ADD COLUMN "reserve" numeric(10, 1) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD COLUMN "pack_id" integer;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_pack_id_medication_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."medication_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_medication_date_pack_key" UNIQUE NULLS NOT DISTINCT("medication_id","date","pack_id");--> statement-breakpoint
ALTER TABLE "medication_packs" ADD CONSTRAINT "medication_packs_reserve_non_negative" CHECK ("medication_packs"."reserve" >= 0);--> statement-breakpoint
ALTER TABLE "medication_packs" ADD CONSTRAINT "medication_packs_reserve_half_step" CHECK (reserve * 2 = trunc(reserve * 2));--> statement-breakpoint
-- Each medication's reserve becomes its default (first) pack's.
UPDATE "medication_packs" p SET "reserve" = m."reserve"
FROM "medications" m
WHERE p."medication_id" = m."id"
  AND p."id" = (SELECT q."id" FROM "medication_packs" q WHERE q."medication_id" = m."id" ORDER BY q."position", q."id" LIMIT 1);
