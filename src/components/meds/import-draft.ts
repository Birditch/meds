"use client";

import { useSyncExternalStore } from "react";
import type { Moment } from "@/lib/meds/simulate";

/*
 * The one-click import form, saved on this device while it is being filled, so a failed submit
 * (e.g. the page was from before a deploy and reloads) or a closed tab loses nothing. Cleared
 * once the import succeeds or the user discards it.
 */

const KEY = "meds:import-draft:v1";
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export interface ImportDraft<R> {
  /** When it was last saved (ms since epoch). */
  savedAt: number;
  text: string;
  rows: R[];
  /** The counting moment the amounts refer to. */
  at: Moment;
}

export function loadImportDraft<R>(): ImportDraft<R> | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<ImportDraft<R>>;
    const atOk = typeof d.at?.date === "string" && [0, 1, 2, 3].includes(d.at?.slotsDone as number);
    if (typeof d.savedAt !== "number" || typeof d.text !== "string" || !Array.isArray(d.rows) || !atOk) return null;
    return d as ImportDraft<R>;
  } catch {
    return null;
  }
}

export function saveImportDraft<R>(draft: ImportDraft<R>) {
  try {
    const had = localStorage.getItem(KEY) !== null;
    localStorage.setItem(KEY, JSON.stringify(draft));
    if (!had) emit();
  } catch {
    // Storage full or blocked: the form still works, just without a draft.
  }
}

export function clearImportDraft() {
  try {
    if (localStorage.getItem(KEY) === null) return;
    localStorage.removeItem(KEY);
    emit();
  } catch {
    // Nothing to clear.
  }
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

const hasDraft = () => {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
};

/** Whether an unsubmitted import is waiting on this device. */
export const useHasImportDraft = () => useSyncExternalStore(subscribe, hasDraft, () => false);
