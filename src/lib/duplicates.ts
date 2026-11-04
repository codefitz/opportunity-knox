import { cleanJobUrl, isHttpUrl } from "./urls.ts";
import type { Opportunity } from "../types.ts";

export function normalizeText(str: string): string {
  return (str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

export function areDuplicates(
  a: { url?: string; company?: string; role?: string },
  b: { url?: string; company?: string; role?: string },
): boolean {
  // 1. Canonical URL match
  if (a.url && b.url && isHttpUrl(a.url.trim()) && isHttpUrl(b.url.trim())) {
    const urlA = cleanJobUrl(a.url.trim());
    const urlB = cleanJobUrl(b.url.trim());
    if (urlA && urlB && urlA === urlB) return true;
  }

  // 2. Normalized Company and Role match
  const compA = normalizeText(a.company || "");
  const compB = normalizeText(b.company || "");
  const roleA = normalizeText(a.role || "");
  const roleB = normalizeText(b.role || "");

  if (compA && compB && roleA && roleB && compA === compB && roleA === roleB) {
    return true;
  }

  return false;
}

export function findDuplicateMap(opportunities: Opportunity[]): Map<string, Opportunity[]> {
  const map = new Map<string, Opportunity[]>();

  for (let i = 0; i < opportunities.length; i++) {
    const oppA = opportunities[i];
    for (let j = i + 1; j < opportunities.length; j++) {
      const oppB = opportunities[j];
      if (areDuplicates(oppA, oppB)) {
        const listA = map.get(oppA.id) || [];
        listA.push(oppB);
        map.set(oppA.id, listA);

        const listB = map.get(oppB.id) || [];
        listB.push(oppA);
        map.set(oppB.id, listB);
      }
    }
  }

  return map;
}

export function findExistingDuplicate(
  candidate: { url?: string; company?: string; role?: string },
  opportunities: Opportunity[],
  excludeId?: string,
): Opportunity | null {
  for (const o of opportunities) {
    if (excludeId && o.id === excludeId) continue;
    if (areDuplicates(candidate, o)) return o;
  }
  return null;
}
