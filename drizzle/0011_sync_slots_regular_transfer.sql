ALTER TABLE "reserve_logs" DROP CONSTRAINT "reserve_logs_time_of_day";--> statement-breakpoint
-- 睡前 is not a dose of its own: the regimen has 早 / 中 / 晚 only.
UPDATE "reserve_logs" SET "time_of_day" = 'evening' WHERE "time_of_day" = 'bedtime';--> statement-breakpoint
ALTER TABLE "reserve_logs" ADD COLUMN "regular" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "reserve_logs" ADD COLUMN "slots_done" smallint;--> statement-breakpoint
ALTER TABLE "reserve_logs" ADD CONSTRAINT "reserve_logs_regular" CHECK (not "reserve_logs"."regular" or "reserve_logs"."time_of_day" is not null);--> statement-breakpoint
ALTER TABLE "reserve_logs" ADD CONSTRAINT "reserve_logs_slots_done" CHECK ("reserve_logs"."slots_done" is null or ("reserve_logs"."kind" = 'transfer' and "reserve_logs"."slots_done" between 0 and 3));--> statement-breakpoint
ALTER TABLE "reserve_logs" ADD CONSTRAINT "reserve_logs_time_of_day" CHECK ("reserve_logs"."time_of_day" is null or ("reserve_logs"."reason" = 'taken' and "reserve_logs"."time_of_day" in ('morning', 'noon', 'evening')));