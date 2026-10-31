import { useEffect, useRef, useState } from "react";
import { FileSearch, LoaderCircle } from "lucide-react";
import { api, ApiError, json, readFile } from "../api";
import { uploadId } from "../lib/upload-queue";
import AIRequestProgress from "./AIRequestProgress";
export type IntakeResult = {
  id: string;
  fields: Record<string, string>;
  evidence: {
    field: string;
    value: string;
    quote: string;
    passageId: string;
    page: number | null;
    method: string;
  }[];
  missing: string[];
  uncertainties: string[];
  warnings: string[];
  ai: { used: boolean; attempted?: boolean; provider?: string; model?: string };
  source: {
    kind: string;
    name: string;
    url: string;
    capturedAt: string;
    sha256: string;
    ocrPages: number[];
  };
  expiresAt: number;
};
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
  applicationRoute: "Application route",
  description: "Job description",
  url: "Source link",
};
export default function JobIntake({
  url,
  text,
  file,
  onApply,
  onBusy,
  onError,
}: {
  url: string;
  text: string;
  file: File | null;
  onApply: (result: IntakeResult, fields: Record<string, string>) => void;
  onBusy: (busy: boolean) => void;
  onError: (e: unknown) => void;
}) {
  const [kind, setKind] = useState(file ? "file" : text ? "text" : "url"),
    [available, setAvailable] = useState(false),
    [useAI, setUseAI] = useState(false),
    [ocr, setOCR] = useState(true),
    [busy, setBusy] = useState(false),
    [request, setRequest] = useState<string | null>(null),
    [result, setResult] = useState<IntakeResult | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    if (file) setKind("file");
    else if (!url && text) setKind("text");
  }, [file, Boolean(url), Boolean(text)]);
  useEffect(() => {
    void api<{ aiAvailable: boolean }>("/job-intake/settings")
      .then((v) => {
        setAvailable(v.aiAvailable);
        setUseAI(v.aiAvailable);
      })
      .catch(onError);
    return () => controller.current?.abort();
  }, []);
  useEffect(() => {
    controller.current?.abort();
    setResult(null);
  }, [
    kind,
    kind === "url" ? url : null,
    kind === "text" ? text : null,
    kind === "file" ? file : null,
  ]);
  async function review() {
    setBusy(true);
    onBusy(true);
    setError("");
    setResult(null);
    const id = uploadId();
    setRequest(id);
    const abort = new AbortController();
    controller.current = abort;
    try {
      if (kind === "file" && (!file || file.size > 15 * 1024 * 1024))
        throw Error("Choose a job-description file up to 15 MB.");
      const body = {
        kind,
        useAI,
        ocr,
        requestId: id,
        ...(kind === "url"
          ? { url }
          : kind === "text"
            ? { text }
            : { name: file!.name, contentBase64: await readFile(file!) }),
      };
      const next = await api<IntakeResult>("/job-intake", {
        ...json(body),
        signal: abort.signal,
      });
      if (abort.signal.aborted) return;
      setResult(next);
      setSelected(Object.keys(next.fields));
    } catch (e) {
      if (
        !abort.signal.aborted &&
        !(e instanceof ApiError && e.status === 499)
      ) {
        setError(
          e instanceof Error ? e.message : "The source could not be reviewed.",
        );
        if (e instanceof ApiError && e.status === 401) onError(e);
      }
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <section className="job-intake" aria-label="Smarter job intake">
      <div className="settings-section-heading">
        <div>
          <h3>
            <FileSearch size={17} />
            Smarter job intake
          </h3>
          <p>
            Read a source, check the evidence, then choose the details to use.
          </p>
        </div>
      </div>
      <div className="form-grid">
        <label className="field">
          <span>Source to review</span>
          <select
            value={kind}
            disabled={busy}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="url">Job link above</option>
            <option value="text">Pasted job description above</option>
            <option value="file">Attached job-description file</option>
          </select>
        </label>
        <div className="field">
          <span>Review options</span>
          <label className="check-field">
            <input
              type="checkbox"
              checked={useAI}
              disabled={busy || !available}
              onChange={(e) => setUseAI(e.target.checked)}
            />
            Ask Career Buddy to extract details
          </label>
          {!available && (
            <small>
              AI job extraction is off. You can still read the source and keep its
              original.
            </small>
          )}
          {((kind === "file" && file?.name.toLowerCase().endsWith(".pdf")) ||
            kind === "url") && (
            <label className="check-field">
              <input
                type="checkbox"
                checked={ocr}
                disabled={busy}
                onChange={(e) => setOCR(e.target.checked)}
              />
              Read scanned PDF pages locally (OCR)
            </label>
          )}
        </div>
      </div>
      {useAI && (
        <p className="buddy-muted">
          Only the extracted job text goes to your configured Career Buddy
          provider. Career Hub evidence is not included.
        </p>
      )}
      <button
        type="button"
        className="button secondary"
        disabled={
          busy ||
          (kind === "url"
            ? !url.trim()
            : kind === "text"
              ? !text.trim()
              : !file)
        }
        onClick={() => void review()}
      >
        {busy ? (
          <>
            <LoaderCircle size={15} className="spin" />
            Reading source…
          </>
        ) : (
          <>Prepare intake review</>
        )}
      </button>
      {request && <AIRequestProgress id={request} onError={onError} />}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div className="lookup-result">
          <h4>Check the extracted details</h4>
          <p>
            {result.source.name} ·{" "}
            {result.ai.used
              ? `${result.ai.provider} · ${result.ai.model}`
              : result.ai.attempted
                ? "AI review unavailable; source read only"
                : "Read without AI"}{" "}
            · {new Date(result.source.capturedAt).toLocaleString()}
          </p>
          <p className="buddy-muted">
            Applying keeps anything you typed. Saving the opportunity retains
            the original source, extracted text and review report in Documents.
          </p>
          <div className="intake-fields">
            {Object.entries(result.fields)
              .filter(([key, value]) => labels[key] && value)
              .map(([key, value]) => {
                const proof = result.evidence.find((e) => e.field === key);
                return (
                  <div key={key} className="intake-field">
                    <label className="check-field">
                      <input
                        type="checkbox"
                        checked={selected.includes(key)}
                        onChange={(e) =>
                          setSelected((v) =>
                            e.target.checked
                              ? [...v, key]
                              : v.filter((k) => k !== key),
                          )
                        }
                      />
                      <strong>{labels[key]}</strong>
                    </label>
                    <p>
                      {value.slice(0, key === "description" ? 400 : 1500)}
                      {value.length > (key === "description" ? 400 : 1500)
                        ? "…"
                        : ""}
                    </p>
                    {proof && (
                      <blockquote>
                        “{proof.quote}”
                        <small>
                          {proof.page ? `Page ${proof.page} · ` : ""}
                          {proof.passageId}
                          {proof.method === "ocr" ? " · OCR" : ""}
                        </small>
                      </blockquote>
                    )}
                  </div>
                );
              })}
          </div>
          {!!result.missing.length && (
            <p>
              <strong>Not found:</strong>{" "}
              {result.missing.map((k) => labels[k] || k).join(", ")}. Leave
              unknown details blank or check the source.
            </p>
          )}
          {!!result.uncertainties.length && (
            <div className="intake-notices">
              <strong>Needs checking</strong>
              <ul>
                {result.uncertainties.map((v, i) => (
                  <li key={i}>{v}</li>
                ))}
              </ul>
            </div>
          )}
          {!!result.warnings.length && (
            <ul className="lookup-warnings">
              {result.warnings.map((v, i) => (
                <li key={i}>{v}</li>
              ))}
            </ul>
          )}
          <div className="intake-actions">
            <a
              className="button secondary small"
              href={"/api/job-intake/" + result.id + "/source"}
              download
            >
              Download original source
            </a>
            <button
              type="button"
              className="button primary small"
              onClick={() =>
                onApply(
                  result,
                  Object.fromEntries(
                    selected.map((key) => [key, result.fields[key]]),
                  ),
                )
              }
            >
              Use selected details & keep source
            </button>
          </div>
          <p className="buddy-muted">
            This review expires after 30 minutes. Nothing is added to the board
            until you save the opportunity.
          </p>
        </div>
      )}
    </section>
  );
}
