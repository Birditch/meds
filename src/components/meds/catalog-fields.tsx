"use client";

import { useEffect, useId, useState, type ReactNode, type Ref } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CatalogMaker, CatalogMatch, MatchCandidate } from "@/lib/meds/drug-catalog/match";
import { proposeTags } from "@/lib/meds/drug-catalog/propose";
import type { CatalogGroup, CatalogPack } from "@/lib/meds/drug-catalog/search";
import { tagLabel } from "@/lib/meds/tags";
import { PACK_UNITS, type PackUnit } from "@/lib/meds/types";
import { cn } from "@/lib/utils";
import { TagBadges } from "./tags";

const DEBOUNCE_MS = 200;

interface SearchResult {
  q: string;
  total: number;
  groups: CatalogGroup[];
}

/** Drugs matching what is being typed; keeps the last answer on screen until the next one arrives. */
function useCatalogSearch(query: string) {
  const [result, setResult] = useState<SearchResult | null>(null);
  const q = query.trim();
  useEffect(() => {
    if (!q) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/drug-catalog?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setResult({ q, ...((await res.json()) as Omit<SearchResult, "q">) });
      } catch {
        if (!ctrl.signal.aborted) setResult(null);
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q]);
  return q ? result : null;
}

/** What the catalog knows about the medication as currently filled in. Null until there is a name. */
export function useCatalogMatch(name: string, dosage: string, brands: readonly string[]): CatalogMatch | null {
  const key = JSON.stringify([name.trim(), dosage.trim(), brands.map((b) => b.trim()).filter(Boolean)]);
  const [match, setMatch] = useState<CatalogMatch | null>(null);
  const named = name.trim().length >= 2;
  useEffect(() => {
    const [n, d, b] = JSON.parse(key) as [string, string, string[]];
    if (n.length < 2) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ name: n, dosage: d });
        for (const brand of b) params.append("brand", brand);
        const res = await fetch(`/api/drug-catalog?${params}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setMatch((await res.json()) as CatalogMatch);
      } catch {
        if (!ctrl.signal.aborted) setMatch(null);
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [key]);
  return named ? match : null;
}

interface ComboOption {
  key: string;
  content: ReactNode;
  pick: () => void;
}

/** Radix closes a dialog on Escape first; while a suggestion list is open, Escape only closes the list. */
export function keepDialogForSuggestions(e: KeyboardEvent) {
  if (document.activeElement?.getAttribute("role") === "combobox" && document.activeElement.getAttribute("aria-expanded") === "true") e.preventDefault();
}

function Combobox({
  id,
  value,
  onChange,
  options,
  placeholder,
  required,
  inputRef,
  wide,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly ComboOption[];
  placeholder?: string;
  required?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  /** Spans both columns of the form it sits in. */
  wide?: boolean;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const show = open && options.length > 0;
  const choose = (o: ComboOption) => {
    o.pick();
    setOpen(false);
    setActive(-1);
  };
  return (
    <div className="relative">
      <Input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={show}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={show && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        placeholder={placeholder}
        required={required}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || !show) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, options.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            // With the list open, Enter chooses; it never submits a half-filled form.
            e.preventDefault();
            if (active >= 0) choose(options[active]);
            else setOpen(false);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {show && (
        <ul
          id={listId}
          role="listbox"
          className={cn("absolute left-0 z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md", wide && "sm:w-[calc(200%+1rem)]")}
        >
          {options.map((o, i) => (
            <li
              key={o.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // Keeps the focus in the input, so the blur does not close the list before the click lands.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(o)}
              className={cn("cursor-pointer rounded-sm px-2 py-1.5 text-sm hover:bg-accent", i === active && "bg-accent")}
            >
              {o.content}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The drug name: suggests from the catalog while typing. Picking one fills the name and strength. */
export function CatalogNameInput({ id, value, onChange, onPick }: { id: string; value: string; onChange: (name: string) => void; onPick: (drug: { name: string; strength: string }) => void }) {
  const result = useCatalogSearch(value);
  const options = (result?.groups ?? []).map((g) => ({
    key: String(g.id),
    pick: () => onPick(g),
    content: (
      <>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">
            {g.name} {g.strength}
          </span>
          <TagBadges tags={g.tags} />
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {g.form} · {g.companies} 家厂家：{g.examples.join("、")}
          {g.companies > g.examples.length && " 等"}
        </span>
      </>
    ),
  }));
  return <Combobox id={id} wide required value={value} onChange={onChange} options={options} placeholder="输入药名、商品名、拼音或厂家，自动匹配" />;
}

export function CatalogStrengthInput({
  id,
  value,
  onChange,
  strengths,
  inputRef,
}: {
  id: string;
  value: string;
  onChange: (strength: string) => void;
  strengths: readonly string[];
  inputRef?: Ref<HTMLInputElement>;
}) {
  const typed = value.trim();
  const options = strengths.filter((s) => s !== typed && s.includes(typed)).map((s) => ({ key: s, pick: () => onChange(s), content: s }));
  return <Combobox id={id} required inputRef={inputRef} value={value} onChange={onChange} options={options} placeholder="如：2mg" />;
}

export const makerLabel = (m: Pick<CatalogMaker, "companyShort" | "brand">) => (m.brand ? `${m.companyShort}（${m.brand}）` : m.companyShort);

export interface PackPatch {
  packUnit: PackUnit;
  perBox: string;
}

/** What the form can hold: a unit it does not know counts as a box. */
const packPatch = (p: CatalogPack): PackPatch => ({
  packUnit: PACK_UNITS.find((u) => u === p.packUnit) ?? "盒",
  perBox: p.perBox > 0 && p.perBox <= 10_000 ? String(p.perBox) : "",
});

interface MakerOption {
  label: string;
  matched: boolean;
  approval: string;
  tags: string[];
  packs: CatalogPack[];
}

/** One entry per manufacturer and brand, across its approval numbers. */
function makerOptions(makers: readonly CatalogMaker[]): MakerOption[] {
  const byLabel = new Map<string, MakerOption>();
  for (const m of makers) {
    const label = makerLabel(m);
    const known = byLabel.get(label);
    if (!known) {
      byLabel.set(label, { label, matched: m.matched, approval: m.approval, tags: m.tags, packs: [...m.packs] });
      continue;
    }
    known.matched ||= m.matched;
    for (const p of m.packs) if (!known.packs.some((x) => x.perBox === p.perBox && x.packUnit === p.packUnit)) known.packs.push(p);
  }
  for (const o of byLabel.values()) o.packs.sort((a, b) => a.perBox - b.perBox);
  return [...byLabel.values()];
}

const packText = (p: CatalogPack) => (p.perBox > 0 ? `${p.perBox}${p.unit}/${p.packUnit}` : p.packUnit);

/** The manufacturer: suggests who makes this drug, narrowed by what is typed. */
export function CatalogMakerInput({
  id,
  value,
  onChange,
  onPick,
  match,
  required,
  inputRef,
}: {
  id: string;
  value: string;
  onChange: (brand: string) => void;
  onPick: (brand: string, pack: PackPatch | null) => void;
  match: CatalogMatch | null;
  required?: boolean;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const typed = value.normalize("NFKC").trim().toLowerCase();
  const options = makerOptions(match?.makers ?? [])
    .filter((o) => o.label !== value.trim() && o.label.normalize("NFKC").toLowerCase().includes(typed))
    .map((o) => ({
      key: o.label,
      pick: () => onPick(o.label, o.packs.length === 1 ? packPatch(o.packs[0]) : null),
      content: (
        <>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium">{o.label}</span>
            <TagBadges tags={o.tags} />
          </span>
          <span className="block truncate text-xs text-muted-foreground tabular-nums">
            {o.approval} · {o.packs.map(packText).join("、")}
          </span>
        </>
      ),
    }));
  return <Combobox id={id} required={required} inputRef={inputRef} value={value} onChange={onChange} options={options} placeholder="如：江苏恩华" />;
}

/** The pack sizes of the manufacturer that was filled in, one tap each. */
export function CatalogPackChips({ match, value, onPick }: { match: CatalogMatch | null; value: PackPatch; onPick: (pack: PackPatch) => void }) {
  const hits = makerOptions(match?.makers ?? []).filter((o) => o.matched);
  if (hits.length !== 1) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground sm:col-span-2">
      <span>{hits[0].label} 的包装：</span>
      {hits[0].packs.map((p) => {
        const patch = packPatch(p);
        const on = patch.perBox === value.perBox && patch.packUnit === value.packUnit;
        return (
          <Button key={packText(p)} type="button" size="xs" variant={on ? "default" : "outline"} aria-pressed={on} title={p.material ?? undefined} onClick={() => onPick(patch)}>
            {packText(p)}
          </Button>
        );
      })}
    </div>
  );
}

/** How the name and strength as filled in relate to the catalog. */
export function CatalogMatchNote({
  match,
  nameDone,
  onUseName,
  onPick,
}: {
  match: CatalogMatch | null;
  /** The person has moved on from the name, so "not found" is an answer and not a word half typed. */
  nameDone: boolean;
  onUseName: (name: string) => void;
  onPick: (drug: MatchCandidate) => void;
}) {
  if (!match) return null;
  if (match.status === "none") return nameDone ? <p className="text-xs text-muted-foreground sm:col-span-2">药品库里没有匹配到这个名称，按你填的保存也可以。</p> : null;
  const maker = makerOptions(match.makers).filter((o) => o.matched);
  return (
    <div
      aria-live="polite"
      className={cn(
        "grid gap-1.5 rounded-lg border px-3 py-2 text-sm sm:col-span-2",
        match.status === "matched" ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-muted/30",
      )}
    >
      {match.group ? (
        <p>
          已匹配药品库：<b>{match.group.name} {match.group.strength}</b>
          {maker.length === 1 && ` · ${maker[0].label}`}。{match.tags.length > 0 && "类型已带入下面的标签，可以删改。"}
        </p>
      ) : (
        <p>药品库里有这些，点一下选中：</p>
      )}
      {match.suggestedName && (
        <p className="flex flex-wrap items-center gap-2">
          {match.nameBasis === "typo" ? `名称可能写错了，药品库里是「${match.suggestedName}」` : `药品库里的全名是「${match.suggestedName}」`}
          <Button type="button" size="xs" variant="outline" className="text-foreground" onClick={() => onUseName(match.suggestedName!)}>
            改成这个
          </Button>
        </p>
      )}
      {match.candidates.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {match.candidates.map((c) => (
            <Button key={c.id} type="button" size="xs" variant="outline" onClick={() => onPick(c)}>
              {c.name} {c.strength}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

const nameOf = (tag: string) => tagLabel(tag).short;

/** "+医保甲、国产；医保乙 换成 医保甲" */
export function TagChanges({ additions, conflicts }: { additions: readonly string[]; conflicts: readonly { from: string; to: string }[] }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {additions.length > 0 && (
        <span className="inline-flex flex-wrap items-center gap-1">
          加上 <TagBadges tags={additions} />
        </span>
      )}
      {conflicts.map((c) => (
        <span key={c.from} className="text-amber-700 dark:text-amber-400">
          {nameOf(c.from)} 换成 {nameOf(c.to)}
        </span>
      ))}
    </span>
  );
}

/** For a medication that already has tags: what the catalog would add or change. Nothing changes until asked. */
export function CatalogTagSuggestion({
  tags,
  match,
  onApply,
  onUseName,
}: {
  tags: readonly string[];
  match: CatalogMatch | null;
  onApply: (tags: string[]) => void;
  onUseName: (name: string) => void;
}) {
  if (!match || match.status === "none") return null;
  const p = proposeTags(tags, match.tags);
  const hasChanges = p.additions.length > 0 || p.conflicts.length > 0;
  if (!hasChanges && !match.suggestedName) return null;
  return (
    <div className="grid gap-1.5 rounded-lg border bg-muted/30 px-3 py-2 text-sm" aria-live="polite">
      {match.group && (
        <p>
          已匹配药品库：<b>{match.group.name} {match.group.strength}</b>
        </p>
      )}
      {match.suggestedName && (
        <p className="flex flex-wrap items-center gap-2">
          {match.nameBasis === "typo" ? `名称可能写错了，药品库里是「${match.suggestedName}」` : `药品库里的全名是「${match.suggestedName}」`}
          <Button type="button" size="xs" variant="outline" onClick={() => onUseName(match.suggestedName!)}>
            改成这个
          </Button>
        </p>
      )}
      {hasChanges && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TagChanges additions={p.additions} conflicts={p.conflicts} />
          <Button type="button" size="xs" onClick={() => onApply(p.next)}>
            采用
          </Button>
        </div>
      )}
    </div>
  );
}
