CREATE TABLE "reserve_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reserve_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"medication_id" integer NOT NULL,
	"pack_id" integer NOT NULL,
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"delta" numeric(10, 1) NOT NULL,
	"supply_log_id" integer,
	"stock_count_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reserve_logs_kind" CHECK ("reserve_logs"."kind" in ('restock', 'draw', 'count', 'transfer')),
	CONSTRAINT "reserve_logs_delta_non_zero" CHECK ("reserve_logs"."delta" <> 0),
	CONSTRAINT "reserve_logs_delta_half_step" CHECK (delta * 2 = trunc(delta * 2))
);
--> statement-breakpoint
ALTER TABLE "reserve_logs" ADD CONSTRAINT "reserve_logs_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."medications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserve_logs" ADD CONSTRAINT "reserve_logs_pack_id_medication_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."medication_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserve_logs" ADD CONSTRAINT "reserve_logs_supply_log_id_supply_logs_id_fk" FOREIGN KEY ("supply_log_id") REFERENCES "public"."supply_logs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserve_logs" ADD CONSTRAINT "reserve_logs_stock_count_id_stock_counts_id_fk" FOREIGN KEY ("stock_count_id") REFERENCES "public"."stock_counts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reserve_logs_medication_date_idx" ON "reserve_logs" USING btree ("medication_id","date");