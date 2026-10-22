import { useEffect, useRef, useState, useId } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  Globe2,
  LoaderCircle,
  Search,
  TriangleAlert,
} from "lucide-react";
import { api, ApiError, json, formatDate } from "../api";
import type { Opportunity } from "../types";

export type JobLookupResult = {
  fields: Partial<Opportunity>;
  method: "structured-data" | "page-content";
  warnings: string[];
  sourceUrl: string;
  resolvedUrl: string;
  retrievedAt: string;
};
export const JOB_FIELDS = [
  "company",
  "role",
  "jobReference",
  "location",
  "workMode",
  "salary",
  "employmentType",
  "contact",
  "deadline",
  "description",
] as const;
const labels: Record<string, string> = {
  company: "Company",
  role: "Role",
  jobReference: "Job reference",
  location: "Location",
  workMode: "Working arrangement",
  salary: "Salary / rate",
  employmentType: "Employment type",
  contact: "Contact",
  deadline: "Closing date",
  description: "Job description",
};
export function lookupNote(result: JobLookupResult) {
  return `Job details retrieved from ${result.sourceUrl} at ${result.retrievedAt}; ${result.method}. Imported details require review against the original listing.${result.resolvedUrl !== result.sourceUrl ? ` Final page: ${result.resolvedUrl}.` : ""}`;
}
export default function JobLookup({
  url,
  onUrlChange,
  onResult,
  onAuthError,
  autoLookup = false,
  preview = false,
}: {
  url: string;
  onUrlChange: (url: string) => void;
  onResult: (result: JobLookupResult) => void;
  onAuthError?: (error: unknown) => void;
  autoLookup?: boolean;
  preview?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<JobLookupResult | null>(null),
    [applied, setApplied] = useState(false);
  const inputId = useId();
  const currentUrl = useRef(url);
  currentUrl.current = url;
  const requestId = useRef(0),
    autoRequested = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (result && url.trim() !== result.sourceUrl.trim()) {
      setResult(null);
      setApplied(false);
    }
  }, [url]);
  async function fetchDetails() {
    const requested = url.trim();
    if (!/^https?:\/\//i.test(requested)) {
      setError("Enter a complete http or https job link first.");
      return;
    }
    const id = ++requestId.current;
    setBusy(true);
    setError("");
    setResult(null);
    setApplied(false);
    try {
      const next = await api<JobLookupResult>(
        "/job-lookup",
        json({ url: requested }),
      );
      if (!alive.current || requestId.current !== id) return;
      if (currentUrl.current.trim() !== requested) {
        setError(
          "The link changed while details were being retrieved. Fetch again for the current link.",
        );
        return;
      }
      setResult(next);
      if (!preview) {
        onResult(next);
        setApplied(true);
      }
    } catch (e) {
      if (!alive.current || requestId.current !== id) return;
      if (currentUrl.current.trim() === requested)
        setError(
          e instanceof Error
            ? e.message
            : "The listing could not be retrieved.",
        );
      if (e instanceof ApiError && e.status === 401) onAuthError?.(e);
    } finally {
      if (alive.current && requestId.current === id) setBusy(false);
    }
  }
  useEffect(() => {
    if (autoLookup && url && !autoRequested.current) {
      autoRequested.current = true;
      void fetchDetails();
    }
  }, []);
  const found = result
    ? JOB_FIELDS.filter(
        (key) => typeof result.fields[key] === "string" && result.fields[key],
      )
    : [];
  return (
    <section
      className={`job-lookup ${preview ? "job-lookup-existing" : ""}`}
      aria-label="Retrieve job details from a link"
    >
      <div className="field">
        <label htmlFor={inputId}>Job link</label>
        <div className="lookup-input-row">
          <span className="lookup-link-icon">
            <Globe2 size={16} />
          </span>
          <input
            id={inputId}
            type="url"
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder="https://company.com/careers/job…"
            aria-label="Job link"
          />
          <button
            type="button"
            className="button secondary"
            onClick={() => void fetchDetails()}
            disabled={busy || !url.trim()}
          >
            {busy ? (
              <>
                <LoaderCircle size={15} className="spin" />
                Fetching…
              </>
            ) : (
              <>
                <Search size={15} />
                Fetch job details
              </>
            )}
          </button>
        </div>
        <small>
          Retrieve details from the public listing, then review and edit them
          below. No AI connection is needed.
        </small>
      </div>
      {error && (
        <div className="lookup-message lookup-error" role="alert">
          <TriangleAlert size={16} />
          <div>
            <strong>We couldn’t fill this in yet.</strong>
            <p>{error}</p>
            <p>
              You can paste the job description, attach a PDF, or enter the
              details manually. Some job sites require a login or block
              automated access.
            </p>
          </div>
        </div>
      )}
      {result && (
        <div className="lookup-result" role="status">
          <div className="lookup-result-heading">
            <span className="lookup-success-icon">
              <Check size={14} />
            </span>
            <strong>
              {found.length
                ? `${found.length} detail${found.length === 1 ? "" : "s"} retrieved`
                : "Page retrieved; details need a manual review"}
            </strong>
            <span>
              {result.method === "structured-data"
                ? "Structured job data"
                : "Page content"}
            </span>
          </div>
          <p className="lookup-review-note">
            {preview
              ? "Existing values are kept. Apply the retrieved details only to empty fields, then review before saving."
              : "Review the editable details below. Anything you have typed is kept; missing information stays blank."}
          </p>
          {preview && found.length > 0 && (
            <dl className="lookup-preview">
              {found.map((key) => (
                <div
                  key={key}
                  className={key === "description" ? "lookup-description" : ""}
                >
                  <dt>{labels[key]}</dt>
                  <dd>{String(result.fields[key])}</dd>
                </div>
              ))}
            </dl>
          )}
          {!!result.warnings?.length && (
            <ul className="lookup-warnings">
              {result.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          )}
          <div className="lookup-provenance">
            <span>
              Retrieved {formatDate(result.retrievedAt, undefined, true)}
            </span>
            <a href={result.sourceUrl} target="_blank" rel="noreferrer">
              Source listing
              <ArrowUpRight size={11} />
            </a>
            {result.resolvedUrl && result.resolvedUrl !== result.sourceUrl && (
              <a
                href={result.resolvedUrl}
                target="_blank"
                rel="noreferrer"
                title={result.resolvedUrl}
              >
                Final page
                <ArrowUpRight size={11} />
              </a>
            )}
          </div>
          {preview && found.length > 0 && (
            <button
              type="button"
              className="button secondary small"
              onClick={() => {
                onResult(result);
                setApplied(true);
              }}
            >
              <ArrowDownToLine size={14} />
              {applied ? "Fill remaining empty fields" : "Fill empty fields"}
            </button>
          )}
          {preview && applied && (
            <p className="lookup-applied">
              <Check size={13} />
              Missing details filled in. Save changes when you’re ready.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
