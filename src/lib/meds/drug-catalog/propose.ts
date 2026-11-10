import { normalizeTags, tagDef } from "../tags";

export interface TagProposal {
  /** Catalog tags that take nothing away. */
  additions: string[];
  /** Catalog tags that would replace one the medication has (医保乙 → 医保甲). */
  conflicts: { from: string; to: string }[];
  /** The tags after taking the additions only. */
  safeNext: string[];
  /** The tags after taking everything. */
  next: string[];
}

/**
 * What the catalog would change on a medication that already has tags. Someone may know better than the
 * catalog (a brand it does not list), so a change is reported apart from a plain addition.
 */
export function proposeTags(current: readonly string[], catalog: readonly string[]): TagProposal {
  const additions: string[] = [];
  const conflicts: TagProposal["conflicts"] = [];
  for (const tag of catalog) {
    if (current.includes(tag)) continue;
    const set = tagDef(tag)?.set;
    const rival = set ? current.find((c) => tagDef(c)?.set === set) : undefined;
    // The plain 抗菌药 says less than a grade already chosen (限制使用级…).
    if (rival && tag === "abx") continue;
    if (rival) conflicts.push({ from: rival, to: tag });
    else additions.push(tag);
  }
  return {
    additions,
    conflicts,
    safeNext: normalizeTags([...current, ...additions]),
    next: normalizeTags([...current, ...additions, ...conflicts.map((c) => c.to)]),
  };
}
