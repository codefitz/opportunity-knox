import { useEffect, useState } from "react";
import { api, json } from "../api";

const sources = {
  esco: {
    name: "ESCO",
    url: "https://esco.ec.europa.eu/en/use-esco/download",
    instructions:
      "Download the English classification in CSV format. Unzip it and import skills_en.csv.",
  },
  soc2020: {
    name: "SOC 2020",
    url: "https://www.ons.gov.uk/methodology/classificationsandstandards/standardoccupationalclassificationsoc/soc2020/soc2020volume2codingrulesandconventions",
    instructions:
      "Download the ONS coding-index workbook. Save the coding-index sheet as CSV UTF-8 and import it here.",
  },
};
type Source = keyof typeof sources;
type Counts = Record<Source, number>;
const path = "/buddy/cv-keywords";

export default function CvKeywordSettings() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const showError = (err: unknown) =>
    setError(
      err instanceof Error
        ? err.message
        : "Keyword sources could not be loaded.",
    );

  useEffect(() => {
    const controller = new AbortController();
    api<Counts>(path, { signal: controller.signal })
      .then(setCounts)
      .catch((err) => {
        if (!controller.signal.aborted) showError(err);
      });
    return () => controller.abort();
  }, []);

  async function update(
    source: Source,
    operation: File | "download" | "remove",
  ) {
    const file = operation instanceof File ? operation : undefined;
    setBusy(true);
    setError("");
    try {
      if (file && file.size > 15_000_000)
        throw new Error("Choose a CSV file smaller than 15 MB.");
      setCounts(
        await api<Counts>(
          path,
          file
            ? json({ source, csv: await file.text() })
            : operation === "download"
              ? json({ source, download: true })
              : json({ source }, "DELETE"),
        ),
      );
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-section" id="cv-keyword-settings">
      <div className="settings-section-heading">
        <div>
          <h2>CV Keyword Sources</h2>
          <p>
            CV tailoring uses wording from the job advert. Import optional
            references for skills and UK job titles.
          </p>
        </div>
      </div>
      {(Object.keys(sources) as Source[]).map((source) => (
        <div key={source}>
          <h3>{sources[source].name}</h3>
          <p>
            {source === "esco"
              ? "English ESCO skills CSV from a public mirror."
              : "ONS coding-index workbook."}
          </p>
          <div className="buddy-buttons">
            <button
              type="button"
              className="button secondary"
              disabled={busy || !counts}
              onClick={() => void update(source, "download")}
            >
              {counts?.[source] ? "Refresh" : "Download and import"}{" "}
              {sources[source].name}
            </button>
            <details>
              <summary>Manual import</summary>
              <p>{sources[source].instructions}</p>
              <p>
                <a href={sources[source].url} target="_blank" rel="noreferrer">
                  Publisher download page
                </a>
              </p>
              <label>
                Import {sources[source].name} CSV{" "}
                <input
                  type="file"
                  accept=".csv,text/csv"
                  disabled={busy || !counts}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (file) void update(source, file);
                  }}
                />
              </label>
            </details>
            {Boolean(counts?.[source]) && (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => void update(source, "remove")}
              >
                Remove {sources[source].name}
              </button>
            )}
          </div>
          <p role="status">
            {counts
              ? counts[source]
                ? `${counts[source].toLocaleString()} terms imported`
                : "Optional source not imported"
              : ""}
          </p>
        </div>
      ))}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
