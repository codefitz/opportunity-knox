export function feedbackIssueDraft(
  entry: { text: string; page: string } | { title: string; body: string },
) {
  const title =
    "title" in entry
      ? entry.title
      : entry.text
          .split(/\r?\n/)
          .find((line) => line.trim())
          ?.trim()
          .slice(0, 100) || "Product feedback";
  const body =
    "body" in entry ? entry.body : `${entry.text}\n\n---\nPage: ${entry.page}`;
  const base = "https://github.com/codefitz/opportunity-knox/issues/new";
  const full = `${base}?${new URLSearchParams({ title, body })}`;
  // Long feedback can exceed browser/proxy URL limits; keep its full text available to copy.
  const bodyIncluded = full.length <= 7500;
  return {
    title,
    body,
    bodyIncluded,
    url: bodyIncluded ? full : `${base}?${new URLSearchParams({ title })}`,
  };
}
