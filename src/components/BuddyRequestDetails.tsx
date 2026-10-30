export type BuddyRequestInfo = {
  id?: string;
  stage: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  timeoutSeconds?: number;
  errorCode?: string;
  preview?: string;
  timings?: Record<string, number>;
  responseMode?: string;
  cancellation?: string;
};
export const requestStage = (stage: string) =>
  ({
    "reading-job-source":"Reading the job source",
    "reading-pdf":"Reading PDF pages",
    ocr:"Reading scanned pages locally",
    preparing: "Preparing sources",
    "waiting-provider": "Waiting for the model",
    "reading-response": "Reading the response",
    "receiving-response": "Receiving the answer",
    "queued-codex": "Waiting for the Codex helper",
    "running-codex": "Codex is working",
    validating: "Checking the answer",
    cancelling: "Stopping the request",
    "stopping-codex": "Stopping Codex",
    completed: "Complete",
    cancelled: "Cancelled",
    "timed-out": "Time limit reached",
    failed: "Could not complete",
    interrupted: "Interrupted",
    stale:"Not saved — opportunity changed",
  })[stage] || stage;
const labels: Record<string, string> = {
  preparationMs: "Source preparation",
  providerMs: "Model request",
  firstResponseMs: "First output",
  modelLoadMs: "Model loading (Ollama)",
  promptEvaluationMs: "Reading context (Ollama)",
  generationMs: "Generating output (Ollama)",
  queueMs: "Codex helper wait",
  executionMs: "Codex execution",
};
export default function BuddyRequestDetails({
  request,
}: {
  request: BuddyRequestInfo | null;
}) {
  if (!request) return null;
  const timings = Object.entries(request.timings || {}).filter(
    ([key, value]) => labels[key] && Number.isFinite(value),
  );
  return (
    <>
      {!request.finishedAt &&
        request.preview &&
        request.stage !== "cancelling" && (
          <section
            className="buddy-live-preview"
            aria-label="Live answer preview"
          >
            <strong>Live preview · not yet saved</strong>
            <p>{request.preview}</p>
          </section>
        )}
      {(timings.length > 0 || request.cancellation) && (
        <details className="buddy-request-details">
          <summary>Response details</summary>
          <dl>
            {timings.map(([key, value]) => (
              <div key={key}>
                <dt>{labels[key]}</dt>
                <dd>{(value / 1000).toFixed(value < 1000 ? 2 : 1)}s</dd>
              </div>
            ))}
          </dl>
          <p className="buddy-muted">
            {request.responseMode === "codex"
              ? "Codex returns the complete answer; live text previews are unavailable for this connection."
              : request.responseMode === "buffered"
                ? "This response arrived in one piece; no live text preview was available."
                : "First output includes connection and model preparation time. Detailed model timings appear only when reported by the provider."}
          </p>
          {request.cancellation && (
            <p>
              {request.cancellation === "codex-process-stopped"
                ? "The local Codex process has stopped."
                : request.cancellation === "transport-stopped"
                  ? "The connection has stopped."
                  : "Cancellation was signalled; the remote service has not confirmed stopping."}{" "}
              Remote computation and usage may continue.
            </p>
          )}
        </details>
      )}
    </>
  );
}
