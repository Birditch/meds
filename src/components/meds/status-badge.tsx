import { CircleCheckIcon, CircleDashedIcon, OctagonAlertIcon, TriangleAlertIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Conclusion, Tone } from "@/lib/meds/format";
import { cn } from "@/lib/utils";

const toneClass: Record<Tone, string> = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  warn: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  danger: "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
  muted: "border-border bg-muted text-muted-foreground",
};

const toneIcon: Record<Tone, typeof CircleCheckIcon> = {
  ok: CircleCheckIcon,
  warn: TriangleAlertIcon,
  danger: OctagonAlertIcon,
  muted: CircleDashedIcon,
};

/** The projected run-out time; colour always comes with an icon so it is never the only signal. */
export function StatusBadge({ conclusion, className }: { conclusion: Conclusion; className?: string }) {
  const Icon = toneIcon[conclusion.tone];
  return (
    <Badge variant="outline" className={cn("h-7 gap-1.5 px-2.5 text-sm tabular-nums", toneClass[conclusion.tone], className)}>
      <Icon className="size-3.5!" />
      {conclusion.badge}
    </Badge>
  );
}

export const toneText: Record<Tone, string> = {
  ok: "text-emerald-700 dark:text-emerald-400",
  warn: "text-amber-700 dark:text-amber-400",
  danger: "text-red-700 dark:text-red-400",
  muted: "text-muted-foreground",
};
