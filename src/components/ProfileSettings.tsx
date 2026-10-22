import { useEffect, useState } from "react";
import {
  Camera,
  Check,
  LoaderCircle,
  Palette,
  Trash2,
  UserRound,
} from "lucide-react";
import { api, ApiError, json } from "../api";
import type { Profile, Theme } from "../types";

export const THEMES: {
  id: Theme;
  name: string;
  description: string;
  swatches: string[];
}[] = [
  {
    id: "forest",
    name: "Forest",
    description: "Quiet greens and soft daylight.",
    swatches: ["#f5f7f2", "#2b654d", "#d7e3cc"],
  },
  {
    id: "cappuccino",
    name: "Cappuccino",
    description: "Warm cream, coffee, and caramel.",
    swatches: ["#f4ede3", "#79543c", "#d6b692"],
  },
  {
    id: "ocean",
    name: "Ocean",
    description: "Cool blues with a clear horizon.",
    swatches: ["#edf4f7", "#28627c", "#a5c6d4"],
  },
  {
    id: "midnight",
    name: "Midnight",
    description: "A softer light for late evenings.",
    swatches: ["#141d24", "#86b4a3", "#35454e"],
  },
];
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("opportunity-knox-theme", theme);
  } catch {
    /* Theme can still apply when local storage is unavailable. */
  }
}
try {
  const cached = localStorage.getItem("opportunity-knox-theme");
  applyTheme(
    THEMES.some((t) => t.id === cached) ? (cached as Theme) : "forest",
  );
} catch {
  document.documentElement.dataset.theme = "forest";
}

export default function ProfileSettings({
  profile,
  onSaved,
  onError,
  onNotice,
}: {
  profile: Profile;
  onSaved: (profile: Profile) => void;
  onError: (error: unknown) => void;
  onNotice: (notice: string) => void;
}) {
  const [name, setName] = useState(profile.name),
    [revision, setRevision] = useState(profile.revision),
    [image, setImage] = useState(""),
    [preview, setPreview] = useState(""),
    [remove, setRemove] = useState(false),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState(false);
  useEffect(() => {
    if (!dirty) {
      setName(profile.name);
      setRevision(profile.revision);
    }
  }, [profile.revision, dirty]);
  async function choose(file?: File) {
    if (!file) return;
    setError("");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Choose a PNG, JPEG, or WebP photo.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("Choose a photo smaller than 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result);
      setPreview(data);
      setImage(data.split(",")[1]);
      setRemove(false);
      setDirty(true);
    };
    reader.onerror = () => setError("The photo could not be read.");
    reader.readAsDataURL(file);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const next = await api<Profile>(
        "/profile",
        json(
          {
            revision,
            name,
            ...(image ? { imageBase64: image } : {}),
            ...(remove ? { removeAvatar: true } : {}),
          },
          "PATCH",
        ),
      );
      onSaved(next);
      setDirty(false);
      setConflict(false);
      setRevision(next.revision);
      setImage("");
      setPreview("");
      setRemove(false);
      onNotice("Your profile is saved.");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Your profile could not be saved.",
      );
      if (e instanceof ApiError && e.status === 401) onError(e);
      if (e instanceof ApiError && e.status === 409) setConflict(true);
    } finally {
      setBusy(false);
    }
  }
  const avatar =
    preview || (!remove && profile.avatarUrl ? profile.avatarUrl : "");
  return (
    <section
      className="settings-section profile-settings"
      id="profile-settings"
    >
      <div className="settings-section-heading">
        <UserRound size={21} />
        <div>
          <h2>Your profile</h2>
          <p>
            A name and photo to make Opportunity Knox feel like your workspace.
          </p>
        </div>
      </div>
      <form onSubmit={save} data-editing={dirty ? "true" : undefined}>
        <div className="profile-editor">
          <div className="profile-photo">
            {avatar ? (
              <img src={avatar} alt="Your profile photo preview" />
            ) : (
              <span>
                {name
                  .trim()
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((s) => s[0])
                  .join("")
                  .toUpperCase() || <UserRound size={30} />}
              </span>
            )}
          </div>
          <div className="profile-photo-actions">
            <label className="button secondary small">
              <Camera size={15} />
              Choose photo
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => void choose(e.target.files?.[0])}
              />
            </label>
            <small>PNG, JPEG, or WebP · up to 2 MB</small>
            {(profile.avatarUrl || preview) && !remove && (
              <button
                className="text-button remove-photo"
                type="button"
                onClick={() => {
                  setRemove(true);
                  setPreview("");
                  setImage("");
                  setDirty(true);
                }}
              >
                <Trash2 size={12} />
                Remove photo
              </button>
            )}
          </div>
        </div>
        <label className="field profile-name-field">
          <span>Your name</span>
          <input
            required
            maxLength={80}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
            placeholder="What should we call you?"
            autoComplete="name"
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {conflict && (
          <button
            type="button"
            className="button secondary small"
            onClick={async () => {
              try {
                const latest = await api<Profile>("/profile");
                onSaved(latest);
                setName(latest.name);
                setRevision(latest.revision);
                setImage("");
                setPreview("");
                setRemove(false);
                setDirty(false);
                setConflict(false);
                setError("");
                onNotice(
                  "Latest profile loaded. Unsaved profile changes were replaced.",
                );
              } catch (e) {
                onError(e);
              }
            }}
          >
            Reload latest profile
          </button>
        )}
        <div className="form-actions">
          <button className="button primary" disabled={busy || !dirty}>
            {busy ? (
              <>
                <LoaderCircle size={15} className="spin" />
                Saving…
              </>
            ) : (
              <>
                <Check size={15} />
                Save profile
              </>
            )}
          </button>
        </div>
      </form>
    </section>
  );
}

export function ThemeSettings({
  theme,
  onChange,
  saving,
}: {
  theme: Theme;
  onChange: (theme: Theme) => void;
  saving: boolean;
}) {
  return (
    <section className="settings-section theme-settings">
      <div className="settings-section-heading">
        <Palette size={21} />
        <div>
          <h2>Make yourself at home</h2>
          <p>Choose a theme. Your preference is saved across devices.</p>
        </div>
        {saving && (
          <LoaderCircle size={16} className="spin" aria-label="Saving theme" />
        )}
      </div>
      <div className="theme-grid" role="group" aria-label="Workspace theme">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={theme === t.id}
            className={`theme-choice ${theme === t.id ? "selected" : ""}`}
            onClick={() => onChange(t.id)}
            disabled={saving}
          >
            <span
              className="theme-preview"
              style={{ background: t.swatches[0] }}
            >
              <span
                className="theme-preview-sidebar"
                style={{ background: t.swatches[2] }}
              />
              <span
                className="theme-preview-card"
                style={{ background: t.swatches[1] }}
              />
              <span
                className="theme-preview-line"
                style={{ background: t.swatches[2] }}
              />
            </span>
            <span className="theme-choice-name">
              {t.name}
              {theme === t.id && <Check size={14} />}
            </span>
            <small>{t.description}</small>
          </button>
        ))}
      </div>
    </section>
  );
}
