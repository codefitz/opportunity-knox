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
import type { Appearance, Profile, Settings, Theme } from "../types";

export const THEMES: {
  id: Theme;
  name: string;
  description: string;
  swatches: string[];
  dark?: boolean;
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
    dark: true,
  },
  {
    id: "lavender",
    name: "Lavender",
    description: "Soft lilac and a little calm.",
    swatches: ["#f4f0fa", "#6a4f89", "#fbf9fe"],
  },
  {
    id: "terracotta",
    name: "Terracotta",
    description: "Sun-warmed clay and cream.",
    swatches: ["#f8eee8", "#9a4f36", "#fffaf7"],
  },
  {
    id: "graphite",
    name: "Graphite",
    description: "Charcoal with cool accents.",
    swatches: ["#17191d", "#a7c5c2", "#1d2025"],
    dark: true,
  },
  {
    id: "plum",
    name: "Plum",
    description: "Deep aubergine and soft violet.",
    swatches: ["#211a26", "#d3aecf", "#291f2e"],
    dark: true,
  },
];
const isHex = (value: string) => /^#[0-9a-f]{6}$/i.test(value);
const themeVars = [
  "--page-bg",
  "--sidebar-bg",
  "--surface",
  "--panel-soft",
  "--field-bg",
  "--panel-hover",
  "--green",
  "--accent-hover",
  "--accent-soft",
  "--on-accent",
  "--focus",
  "--selection",
  "--ink",
  "--ink-secondary",
  "--muted",
];
const rgb = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hexFrom = (r: number[]) =>
  "#" + r.map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");
const mix = (a: string, b: string, proportion: number) =>
  hexFrom(rgb(a).map((v, i) => v * (1 - proportion) + rgb(b)[i] * proportion));
const luminance = (hex: string) =>
  rgb(hex)
    .map((v) => v / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a: string, b: string) => {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
/** Saved values are used only when no in-memory draft is being previewed. */
export function appearanceFrom(settings: Settings): Appearance {
  return {
    theme: settings.theme || "forest",
    themeAccent: settings.themeAccent || "",
    themeBackground: settings.themeBackground || "",
  };
}
export function applyTheme(appearance: Appearance, cache = true) {
  const theme = THEMES.some((t) => t.id === appearance.theme)
    ? appearance.theme
    : "forest";
  const root = document.documentElement;
  // Remove prior overrides before reading the selected preset's base tokens.
  for (const property of themeVars) root.style.removeProperty(property);
  root.dataset.theme = theme;
  const styles = getComputedStyle(root);
  const bases: Record<string, string> = {};
  for (const property of themeVars)
    bases[property] = styles.getPropertyValue(property).trim();
  const background = isHex(appearance.themeBackground)
    ? appearance.themeBackground
    : "";
  const tint = (base: string) =>
    background && isHex(base) ? mix(base, background, 0.08) : base;
  const dark = Boolean(THEMES.find((t) => t.id === theme)?.dark);
  const surfaceVars = themeVars.slice(0, 6);
  if (background) {
    for (const property of surfaceVars)
      if (isHex(bases[property]))
        root.style.setProperty(property, tint(bases[property]));
    // Preserve existing text contrast for low-contrast combinations and retain
    // at least 4.5:1 where the preset had it, across all tinted surfaces.
    for (const property of ["--ink", "--ink-secondary", "--muted"]) {
      const original = bases[property];
      if (!isHex(original)) continue;
      let adjusted = original;
      const surfaces = surfaceVars.map((name) => bases[name]).filter(isHex);
      for (let i = 0; i <= 100; i++) {
        adjusted = mix(original, dark ? "#ffffff" : "#000000", i / 100);
        if (
          surfaces.every(
            (base) =>
              contrast(adjusted, tint(base)) + 0.000001 >=
              Math.min(4.5, contrast(original, base)),
          )
        )
          break;
      }
      root.style.setProperty(property, adjusted);
    }
  }
  const customAccent = isHex(appearance.themeAccent)
    ? appearance.themeAccent
    : "";
  // A tint also needs the preset accent adjusted against the new surfaces.
  const selected =
    customAccent ||
    (background && isHex(bases["--green"]) ? bases["--green"] : "");
  if (selected) {
    const against = [
      "--page-bg",
      "--sidebar-bg",
      "--surface",
      "--panel-soft",
      "--field-bg",
      "--panel-hover",
    ]
      .map((k) => tint(bases[k]))
      .filter(isHex);
    let accent = selected;
    // Preserve hue where possible while ensuring text remains readable on the theme's surfaces.
    for (let i = 0; i <= 100; i++) {
      accent = mix(selected, dark ? "#ffffff" : "#000000", i / 100);
      const panel = tint(bases["--panel-soft"]);
      if (
        against.every((bg) => contrast(accent, bg) >= 4.5) &&
        (!isHex(panel) || contrast(accent, mix(panel, accent, 0.13)) >= 4.5)
      )
        break;
    }
    const ink =
      contrast(accent, "#ffffff") >= contrast(accent, "#151515")
        ? "#ffffff"
        : "#151515";
    root.style.setProperty("--green", accent);
    root.style.setProperty("--on-accent", ink);
    root.style.setProperty(
      "--accent-hover",
      mix(accent, dark ? "#ffffff" : "#000000", 0.14),
    );
    const softBase = tint(bases["--panel-soft"]);
    if (isHex(softBase)) {
      root.style.setProperty("--accent-soft", mix(softBase, accent, 0.13));
      root.style.setProperty("--selection", mix(softBase, accent, 0.24));
    }
    root.style.setProperty("--focus", accent);
  }
  if (cache)
    try {
      localStorage.setItem("opportunity-knox-theme", theme);
      localStorage.setItem("opportunity-knox-theme-accent", customAccent);
      localStorage.setItem("opportunity-knox-theme-background", background);
    } catch {
      /* Theme still applies if browser storage is unavailable. */
    }
}
try {
  const cached = localStorage.getItem("opportunity-knox-theme");
  applyTheme({
    theme: THEMES.some((t) => t.id === cached) ? (cached as Theme) : "forest",
    themeAccent: localStorage.getItem("opportunity-knox-theme-accent") || "",
    themeBackground:
      localStorage.getItem("opportunity-knox-theme-background") || "",
  });
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
  appearance,
  onChange,
  onSave,
  onReset,
  saving,
  dirty,
}: {
  appearance: Appearance;
  onChange: (patch: Partial<Appearance>) => void;
  onSave: () => void;
  onReset: () => void;
  saving: boolean;
  dirty: boolean;
}) {
  const preset = THEMES.find((t) => t.id === appearance.theme) || THEMES[0];
  return (
    <section
      className="settings-section theme-settings"
      data-editing={dirty ? "true" : undefined}
    >
      <div className="settings-section-heading">
        <Palette size={21} />
        <div>
          <h2>Make yourself at home</h2>
          <p>
            Choose a theme and make it yours. Save to use it across devices.
          </p>
        </div>
        {saving && (
          <LoaderCircle
            size={16}
            className="spin"
            aria-label="Saving appearance"
          />
        )}
      </div>
      <div className="theme-grid" role="group" aria-label="Workspace theme">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={appearance.theme === t.id}
            className={`theme-choice ${appearance.theme === t.id ? "selected" : ""}`}
            onClick={() => onChange({ theme: t.id })}
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
              {appearance.theme === t.id && <Check size={14} />}
            </span>
            <small>{t.description}</small>
          </button>
        ))}
      </div>
      <div className="theme-customise">
        <div>
          <h3>Customise colours</h3>
          <p>
            Colours preview here before you save. Accent shades are adjusted for
            readability; background colour adds a subtle tint.
          </p>
        </div>
        <div className="theme-colour-grid">
          <div className="theme-colour-control">
            <label htmlFor="theme-accent">Accent colour</label>
            <div>
              <input
                id="theme-accent"
                type="color"
                value={appearance.themeAccent || preset.swatches[1]}
                onChange={(e) => onChange({ themeAccent: e.target.value })}
                disabled={saving}
              />{" "}
              <span>{appearance.themeAccent || "Theme default"}</span>
            </div>
            {appearance.themeAccent && (
              <button
                className="text-button"
                type="button"
                onClick={() => onChange({ themeAccent: "" })}
                disabled={saving}
              >
                Use theme accent
              </button>
            )}
          </div>
          <div className="theme-colour-control">
            <label htmlFor="theme-background">Background tint</label>
            <div>
              <input
                id="theme-background"
                type="color"
                value={appearance.themeBackground || preset.swatches[0]}
                onChange={(e) => onChange({ themeBackground: e.target.value })}
                disabled={saving}
              />{" "}
              <span>{appearance.themeBackground || "Theme default"}</span>
            </div>
            {appearance.themeBackground && (
              <button
                className="text-button"
                type="button"
                onClick={() => onChange({ themeBackground: "" })}
                disabled={saving}
              >
                Use theme background
              </button>
            )}
          </div>
        </div>
        <div className="theme-save-row">
          <button
            className="button primary"
            type="button"
            onClick={onSave}
            disabled={saving || !dirty}
          >
            Save appearance
          </button>
          <button
            className="button secondary"
            type="button"
            onClick={onReset}
            disabled={
              saving || (!appearance.themeAccent && !appearance.themeBackground)
            }
          >
            Reset colours
          </button>
          <small>
            {dirty
              ? "Preview only — save to use across devices."
              : "Appearance saved across devices."}{" "}
            Reset clears the custom colours in this preview; Save applies the
            reset across devices.
          </small>
        </div>
      </div>
    </section>
  );
}
