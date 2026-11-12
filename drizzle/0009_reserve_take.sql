ALTER TABLE "reserve_logs" DROP CONSTRAINT "reserve_logs_kind";--> statement-breakpoint
ALTER TABLE "reserve_logs" DROP CONSTRAINT "reserve_logs_reason";--> statement-breakpoint
ALTER TABLE "reserve_logs" ADD COLUMN "time_of_day" text;--> statement-breakpoint
-- 额外服用 is its own kind now: a 消耗 for that reason becomes a 服用 (time of day unknown).
UPDATE "reserve_logs" SET "kind" = 'take', "reason" = NULL WHERE "kind" = 'use' AND "reason" = 'extra';--> statement-breakpoint
ALTER TABLE "reserve_logs" ADD CONSTRAINT "reserve_logs_time_of_day" CHECK ("reserve_logs"."time_of_day" is null or "reserve_logs"."time_of_day" in ('morning', 'noon', 'evening', 'bedtime'));--> statement-breakpoint
ALTER TABLE "reserve_logs" ADD CONSTRAINT "reserve_logs_kind" CHECK ("reserve_logs"."kind" in ('restock', 'draw', 'count', 'transfer', 'take', 'use', 'missed'));--> statement-breakpoint
ALTER TABLE "reserve_logs" ADD CONSTRAINT "reserve_logs_reason" CHECK ("reserve_logs"."reason" is null or "reserve_logs"."reason" in ('carry', 'expired', 'damaged', 'lost', 'given', 'returned', 'other'));