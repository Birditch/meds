ALTER TABLE "reserve_logs" DROP CONSTRAINT "reserve_logs_kind";--> statement-breakpoint
ALTER TABLE "reserve_logs" DROP CONSTRAINT "reserve_logs_reason";--> statement-breakpoint
ALTER TABLE "reserve_logs" DROP CONSTRAINT "reserve_logs_time_of_day";--> statement-breakpoint
-- 服用 is a 消耗 reason again (已服用), and the reasons are merged: 过期处理 + 损坏丢弃 = 丢弃, 给了别人 + 退药 = 送人/退药.
UPDATE "reserve_logs" SET "kind" = 'use', "reason" = 'taken' WHERE "kind" = 'take';--> statement-breakpoint
UPDATE "reserve_logs" SET "reason" = 'discarded' WHERE "reason" IN ('expired', 'damaged');--> statement-breakpoint
UPDATE "reserve_logs" SET "reason" = 'given' WHERE "reason" = 'returned';--> statement-breakpoint
UPDATE "reserve_logs" SET "time_of_day" = NULL WHERE "reason" IS DISTINCT FROM 'taken';--> statement-breakpoint
ALTER TABLE "reserve_logs" ADD CONSTRAINT "reserve_logs_kind" CHECK ("reserve_logs"."kind" in ('restock', 'draw', 'count', 'transfer', 'use', 'missed'));--> statement-breakpoint
ALTER TABLE "reserve_logs" ADD CONSTRAINT "reserve_logs_reason" CHECK ("reserve_logs"."reason" is null or "reserve_logs"."reason" in ('taken', 'carry', 'discarded', 'lost', 'given', 'other'));--> statement-breakpoint
ALTER TABLE "reserve_logs" ADD CONSTRAINT "reserve_logs_time_of_day" CHECK ("reserve_logs"."time_of_day" is null or ("reserve_logs"."reason" = 'taken' and "reserve_logs"."time_of_day" in ('morning', 'noon', 'evening', 'bedtime')));