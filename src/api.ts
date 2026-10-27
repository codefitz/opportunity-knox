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

export type DroppedFile = {
  file: File;
  path: string;
};

type WebkitEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (
    success: (file: File) => void,
    error?: (err: unknown) => void,
  ) => void;
  createReader?: () => {
    readEntries: (
      success: (entries: WebkitEntry[]) => void,
      error?: (err: unknown) => void,
    ) => void;
  };
};

const IGNORED_DIRS = new Set([
  ".git",
  ".obsidian",
  ".trash",
  "node_modules",
  "__macosx",
]);

function shouldIgnoreSegment(segment: string): boolean {
  const lower = segment.toLowerCase();
  return (
    !segment ||
    segment === "." ||
    segment === ".." ||
    segment.startsWith(".") ||
    IGNORED_DIRS.has(lower)
  );
}

export function cleanUploadPath(rawPath: string): string | null {
  const segments = rawPath.replace(/\\/g, "/").split("/").filter(Boolean);
  if (!segments.length || segments.some(shouldIgnoreSegment)) return null;
  const joined = segments.join("/");
  return joined.length <= 500 ? joined : segments[segments.length - 1];
}

async function traverseEntry(
  entry: WebkitEntry,
  prefix = "",
  out: DroppedFile[] = [],
): Promise<DroppedFile[]> {
  if (shouldIgnoreSegment(entry.name))
    return out;
  const currentPath = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile && entry.file) {
    const file = await new Promise<File | null>((resolve) => {
      entry.file!(
        (f) => resolve(f),
        () => resolve(null),
      );
    });
    const clean = cleanUploadPath(currentPath);
    if (file && clean) out.push({ file, path: clean });
    return out;
  }
  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    while (true) {
      const batch = await new Promise<WebkitEntry[]>((resolve) => {
        reader.readEntries(
          (entries) => resolve(entries || []),
          () => resolve([]),
        );
      });
      if (!batch.length) break;
      for (const child of batch) {
        await traverseEntry(child, currentPath, out);
      }
    }
  }
  return out;
}

export async function collectDroppedFiles(
  dataTransfer: DataTransfer,
): Promise<DroppedFile[]> {
  const items = Array.from(dataTransfer.items || []);
  const entries = items
    .map(
      (item) =>
        (item.webkitGetAsEntry?.() as unknown as WebkitEntry | null) || null,
    )
    .filter((entry): entry is WebkitEntry => entry !== null);
  if (entries.length) {
    const out: DroppedFile[] = [];
    for (const entry of entries) {
      await traverseEntry(entry, "", out);
    }
    if (out.length) return out;
  }
  return collectFileList(dataTransfer.files);
}

export function collectFileList(
  files: FileList | File[] | null,
): DroppedFile[] {
  if (!files) return [];
  const out: DroppedFile[] = [];
  for (const file of Array.from(files)) {
    const raw =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
      file.name;
    const clean = cleanUploadPath(raw);
    if (clean) out.push({ file, path: clean });
  }
  return out;
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
