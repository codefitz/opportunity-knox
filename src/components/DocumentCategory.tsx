import { useEffect, useState } from "react";
import categories, {libraryCategory} from "../lib/document-categories";
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
    [value, setValue] = useState(libraryCategory(document.category));
  useEffect(() => setValue(libraryCategory(document.category)), [document.category]);
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
              setValue(libraryCategory(document.category));
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
