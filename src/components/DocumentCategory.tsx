import { useEffect, useState } from "react";
import categories from "../../server/document-categories.json";
import { api, json } from "../api";
import type { BoardDocument } from "../types";
export default function DocumentCategory({
  document,
  onChanged,
  onError,
}: {
  document: BoardDocument;
  onChanged: () => void;
  onError: (e: unknown) => void;
}) {
  const [busy, setBusy] = useState(false),
    [value, setValue] = useState(document.category || "other");
  useEffect(() => setValue(document.category || "other"), [document.category]);
  return (
    <label className="field">
      <span>Category</span>
      <select
        aria-label={"Category for " + document.name}
        value={value}
        disabled={busy}
        onChange={(e) => {
          setValue(e.target.value);
          setBusy(true);
          void api(
            "/documents/" + document.id,
            json(
              { revision: document.revision ?? 1, category: e.target.value },
              "PATCH",
            ),
          )
            .then(onChanged)
            .catch((e) => {
              setValue(document.category || "other");
              onError(e);
            })
            .finally(() => setBusy(false));
        }}
      >
        {categories.map((c) => (
          <option value={c.id} key={c.id}>
            {c.label}
          </option>
        ))}
      </select>
    </label>
  );
}
