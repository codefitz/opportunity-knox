import allCategories from "../../server/document-categories.json";
const ids = ["master-cv", "master-cover-letter", "cv-template", "cover-letter-template", "project", "note", "reference-cv", "reference-cover"];
const labels = ["Master CV", "Master cover letter", "CV templates", "Cover letter templates", "Project files", "Note files", "Reference CVs", "Reference covers"];
export default ids.map((id, i) => ({ ...allCategories.find(c => c.id === id)!, label: labels[i] }));
export function libraryCategory(category?: string) {
  if (ids.includes(category || "")) return category!;
  return ({ template: "cv-template", cv: "reference-cv", "tailored-cv": "reference-cv", "cover-letter": "reference-cover" } as Record<string,string>)[category || ""] || "note";
}
