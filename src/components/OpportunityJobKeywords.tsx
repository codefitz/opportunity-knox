import { useEffect, useState } from "react";
import { api } from "../api";

export default function OpportunityJobKeywords({
  id,
  hasAdvert,
}: {
  id: string;
  hasAdvert: boolean;
}) {
  const [terms, setTerms] = useState<string[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!hasAdvert) return;
    const controller = new AbortController();
    api<{ terms: string[] }>(
      `/opportunities/${encodeURIComponent(id)}/buddy/job-keywords`,
      {
        signal: controller.signal,
      },
    )
      .then(({ terms }) => setTerms(terms))
      .catch((err) => {
        if (!controller.signal.aborted)
          setError(
            err instanceof Error
              ? err.message
              : "Could not read job description keywords.",
          );
      });
    return () => controller.abort();
  }, [id, hasAdvert]);

  return (
    <section
      className="workflow-section ai-summary-container"
      aria-label="Job description keywords"
    >
      <div className="section-intro">
        <h3>Job description keywords</h3>
        <p>
          Skills, tools and phrases from the advert to review before tailoring
          your CV.
        </p>
      </div>
      <div className="ai-summary-card">
        {terms?.length ? (
          <ul className="job-keywords">
            {terms.map((term) => (
              <li key={term}>{term}</li>
            ))}
          </ul>
        ) : (
          <p className="job-keywords-status" role={error ? "alert" : "status"}>
            {error ||
              (!hasAdvert
                ? "Add a job description in Overview to see its keywords."
                : terms
                  ? "No keywords were identified in this advert."
                  : "Reading keywords from the job description…")}
          </p>
        )}
      </div>
    </section>
  );
}
