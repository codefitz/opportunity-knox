import { cleanJobUrl } from "./url-cleaner.mjs";

export function normalizeText(str) {
  return String(str ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

export function areDuplicates(a, b) {
  if (!a || !b) return false;

  // 1. Canonical URL match
  if (typeof a.url === "string" && typeof b.url === "string") {
    const rawA = a.url.trim();
    const rawB = b.url.trim();
    if (rawA.startsWith("http") && rawB.startsWith("http")) {
      const urlA = cleanJobUrl(rawA);
      const urlB = cleanJobUrl(rawB);
      if (urlA && urlB && urlA === urlB) return true;
    }
  }

  // 2. Normalized Company and Role match
  const compA = normalizeText(a.company);
  const compB = normalizeText(b.company);
  const roleA = normalizeText(a.role);
  const roleB = normalizeText(b.role);

  if (compA && compB && roleA && roleB && compA === compB && roleA === roleB) {
    return true;
  }

  return false;
}

export function findExistingDuplicate(candidate, opportunities, excludeId = null) {
  for (const o of opportunities) {
    if (excludeId && o.id === excludeId) continue;
    if (areDuplicates(candidate, o)) return o;
  }
  return null;
}
