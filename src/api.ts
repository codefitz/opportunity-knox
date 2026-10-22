export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      data.error || `Request failed (${response.status}).`,
      response.status,
    );
  return data as T;
}
export const json = (body: unknown, method = "POST"): RequestInit => ({
  method,
  body: JSON.stringify(body),
});
export async function readFile(file: File): Promise<string> {
  if (file.size > 15 * 1024 * 1024)
    throw new Error("Please choose a document smaller than 15 MB.");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("The document could not be read."));
    reader.readAsDataURL(file);
  });
}
export function download(name: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function localInput(value?: string) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.valueOf())) return "";
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function iso(value: string) {
  return value ? new Date(value).toISOString() : undefined;
}
export function formatDate(
  value: string,
  timezone = "Europe/London",
  withTime = false,
) {
  if (!value) return "Not set";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value))
    return new Date(value + "T12:00:00Z").toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? ({ hour: "2-digit", minute: "2-digit" } as const) : {}),
    timeZone: timezone,
  });
}

/** Preserve exact stored precision and DST occurrence when only other fields are edited. */
export function editedTimestamp(localValue: string, originalValue?: string) {
  return localValue === localInput(originalValue)
    ? originalValue || ""
    : iso(localValue) || "";
}
