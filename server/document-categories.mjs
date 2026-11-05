import categories from "./document-categories.json" with { type: "json" };
export { categories };
const categoryKinds = {
  "reference-cv": "cv",
  "master-cover-letter": "cover",
  "reference-cover": "cover",
  "master-cv": "cv",
  "tailored-cv": "cv",
  cv: "cv",
  "cover-letter": "cover",
  "job-description": "jd",
  reference: "reference",
};

/** Classify each imported file locally; explicit choices always take precedence. */
export function inferDocumentClassification({
  name,
  kind,
  category,
  opportunityId,
}) {
  const parts = name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .split("/")
    .reverse();
  let inferred = "";
  for (const part of parts) {
    const text = part.replace(/[_-]+/g, " ");
    const has = (pattern) => new RegExp(`\\b(?:${pattern})\\b`, "i").test(text);
    if (has("templates?")) inferred = "template";
    else if (has("cover(?:ing)? letters?"))
      inferred = has("master") ? "master-cover-letter" : "cover-letter";
    else if (has("supporting statements?|personal statements?"))
      inferred = "supporting-statement";
    else if (has("star stor(?:y|ies)|interview stor(?:y|ies)"))
      inferred = "star-story";
    else if (has("job descriptions?|job specs?|job specifications?|jd"))
      inferred = "job-description";
    else if (has("cvs?|c\\.v\\.|r[eé]sum[eé]s?|curriculum vitae"))
      inferred = has("master")
        ? "master-cv"
        : has("tailored")
          ? "tailored-cv"
          : "cv";
    else if (has("references?|career references?")) inferred = "reference";
    if (inferred) break;
  }
  const resolvedKind = kind || categoryKinds[category || inferred] || "other";
  const resolvedCategory =
    category ||
    (inferred && (!kind || (categoryKinds[inferred] || "other") === kind)
      ? inferred === "cv"
        ? documentCategory({ kind: "cv", opportunityId })
        : inferred
      : documentCategory({ kind: resolvedKind, opportunityId }));
  return { kind: resolvedKind, category: resolvedCategory };
}
export function documentCategory(d) {
  if (categories.some((c) => c.id === d.category)) return d.category;
  if (d.generation?.master) return "master-cv";
  if (d.kind === "cv") return d.opportunityId ? "tailored-cv" : "cv";
  return (
    { cover: "cover-letter", jd: "job-description", reference: "reference" }[
      d.kind
    ] || "other"
  );
}
export function validateCategory(value) {
  if (!categories.some((c) => c.id === value))
    throw Object.assign(new Error("Choose a supported document category."), {
      status: 400,
    });
  return value;
}
