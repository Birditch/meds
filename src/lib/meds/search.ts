/**
 * Fuzzy medication search. Every whitespace-separated term must match some field (name,
 * brand, dosage, or their pinyin / pinyin initials) as a substring or, failing that, as an
 * in-order subsequence ("阿林" → 阿莫西林, "amxl" → amoxilin's initials). Results keep their
 * original order within the same score.
 */

export interface Searchable {
  name: string;
  brand: string | null;
  dosage: string;
  searchKeys?: readonly string[];
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (const ch of hay) if (ch === needle[i] && ++i === needle.length) return true;
  return needle.length === 0;
}

/** 0 = no match; higher is better. */
export function matchScore(item: Searchable, query: string): number {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 1;
  const name = norm(item.name);
  const fields = [name, norm(item.brand ?? ""), norm(item.dosage), ...(item.searchKeys ?? []).map(norm)].filter(Boolean);
  let score = 0;
  for (const term of terms) {
    let best = 0;
    for (const f of fields) {
      const at = f.indexOf(term);
      const s = at === 0 ? (f === name ? 6 : 4) : at > 0 ? 3 : isSubsequence(term, f) ? 1 : 0;
      best = Math.max(best, s);
    }
    if (best === 0) return 0;
    score += best;
  }
  return score;
}

export function searchMedications<T extends Searchable>(items: readonly T[], query: string): T[] {
  if (!query.trim()) return [...items];
  return items
    .map((item, i) => ({ item, i, score: matchScore(item, query) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((r) => r.item);
}
