import categories from "./document-categories.json" with { type: "json" };
export { categories };
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
