import { useEffect, useState } from "react";
import { api, json } from "../api";
type Request = {
  id: string;
  stage: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
};
export default function AIRequestProgress({
  id,
  scope,
  onError,
  cancellable = true,
}: {
  id: string | null;
  scope?: string;
  cancellable?: boolean;
  onError: (e: unknown) => void;
}) {
  const [request, setRequest] = useState<Request | null>(null),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    setRequest(null);
    if (!id && !scope) return;
    let live = true;
    let timer: ReturnType<typeof setInterval>;
    const poll = async () => {
      try {
        const r = await api<{ request: Request | null }>(
          id
            ? "/buddy/requests/" + encodeURIComponent(id)
            : "/buddy/requests?scope=" + encodeURIComponent(scope!),
        );
        if (live) {
          setRequest(r.request);
          setNow(Date.now());
          if (r.request?.finishedAt) clearInterval(timer);
        }
      } catch {
        /* The initiating POST may still be validating. */
      }
    };
    void poll();
    timer = setInterval(() => void poll(), 1000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [id, scope]);
  if (!request && !id) return null;
  return (
    <div className="buddy-working" role="status">
      <span>
        {request?.stage || "Starting"} ·{" "}
        {request
          ? Math.max(
              0,
              Math.floor(
                (request.durationMs ?? now - Date.parse(request.startedAt)) /
                  1000,
              ),
            )
          : 0}
        s
      </span>
      {cancellable && !request?.finishedAt && (
        <button
          type="button"
          className="button secondary small"
          onClick={() =>
            void api(
              "/buddy/requests/" + encodeURIComponent(request?.id || id!),
              json({ cancel: true }),
            ).catch(onError)
          }
        >
          Cancel request
        </button>
      )}
    </div>
  );
}
