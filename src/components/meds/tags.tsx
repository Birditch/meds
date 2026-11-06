"use client";

import { ChevronDownIcon, PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { TAG_GROUPS, TAGS, resolveTag, tagDef, tagLabel, toggleTag, type TagTone } from "@/lib/meds/tags";
import { cn } from "@/lib/utils";

export const TONE_CLASS: Record<TagTone, string> = {
  red: "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
  orange: "border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-300",
  amber: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  green: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  sky: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300",
  violet: "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-300",
  slate: "border-border bg-muted/60 text-foreground/80",
};

/** One tag as a small badge: the short name, the full name and its note on hover. */
export function TagBadge({ tag, onRemove, className }: { tag: string; onRemove?: () => void; className?: string }) {
  const { short, label, tone } = tagLabel(tag);
  const note = tagDef(tag)?.note;
  return (
    <Badge variant="outline" className={cn("gap-1 font-normal", TONE_CLASS[tone], className)} title={note ? `${label}：${note}` : label}>
      {short}
      {onRemove && (
        <button type="button" aria-label={`去掉标签 ${label}`} className="-mr-1 rounded-sm opacity-70 hover:opacity-100" onClick={onRemove}>
          <XIcon className="size-3" />
        </button>
      )}
    </Badge>
  );
}

export function TagBadges({ tags, className }: { tags: readonly string[]; className?: string }) {
  if (!tags.length) return null;
  return (
    <span className={cn("inline-flex flex-wrap gap-1", className)}>
      {tags.map((t) => (
        <TagBadge key={t} tag={t} />
      ))}
    </span>
  );
}

/** Pick tags from the catalog (grouped; exclusive ones replace each other) or type your own. */
export function TagPicker({ value, onChange, id }: { value: string[]; onChange: (tags: string[]) => void; id?: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const add = () => {
    const t = resolveTag(text);
    if (t && !value.includes(t)) onChange(toggleTag(value, t));
    setText("");
  };
  const quick = ["rx", "otc", "psy2", "psy1", "narcotic", "ins-b", "ins-a", "imported", "abx"];
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((t) => (
          <TagBadge key={t} tag={t} onRemove={() => onChange(value.filter((x) => x !== t))} />
        ))}
        {value.length === 0 && <span className="text-xs text-muted-foreground">还没有标签</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {quick
          .filter((code) => !value.includes(code))
          .map((code) => (
            <TagChip key={code} code={code} active={false} onClick={() => onChange(toggleTag(value, code))} />
          ))}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-6 items-center gap-0.5 rounded-full px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          全部标签
          <ChevronDownIcon className={cn("size-3 transition-transform", open && "rotate-180")} />
        </button>
      </div>
      {open && (
        <div className="grid gap-2.5 rounded-lg border bg-muted/20 p-3">
          {TAG_GROUPS.map((g) => (
            <div key={g.id} className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">{g.title}</span>
              <div className="flex flex-wrap gap-1.5">
                {TAGS.filter((t) => t.group === g.id).map((t) => (
                  <TagChip key={t.code} code={t.code} active={value.includes(t.code)} full onClick={() => onChange(toggleTag(value, t.code))} />
                ))}
              </div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">同一类里只能选一个（如精一 / 精二、处方 / 非处方、医保甲 / 乙），选新的会替换旧的。</p>
        </div>
      )}
      <div className="flex gap-2">
        <Input
          id={id}
          placeholder="自己加标签，如：饭后服、精二、医保乙类"
          value={text}
          className="h-8"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              add();
            }
          }}
        />
        <button
          type="button"
          onClick={add}
          disabled={!text.trim()}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border px-2.5 text-sm hover:bg-muted disabled:opacity-50"
        >
          <PlusIcon className="size-3.5" />
          添加
        </button>
      </div>
    </div>
  );
}

function TagChip({ code, active, full, onClick }: { code: string; active: boolean; full?: boolean; onClick: () => void }) {
  const d = tagDef(code)!;
  return (
    <button
      type="button"
      aria-pressed={active}
      title={d.note ? `${d.label}：${d.note}` : d.label}
      onClick={onClick}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition-colors",
        active ? TONE_CLASS[d.tone] : "border-dashed text-muted-foreground hover:border-solid hover:text-foreground",
      )}
    >
      {!active && <PlusIcon className="size-3" />}
      {full ? d.label : d.short === d.label ? d.label : `${d.short}（${d.label}）`}
    </button>
  );
}
