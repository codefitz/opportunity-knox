import { useEffect, useState, useRef, useCallback } from "react";
import {
  AlertCircle,
  Camera,
  Check,
  LoaderCircle,
  Palette,
  RotateCcw,
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
  navDark?: boolean;
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
  {
    id: "espresso-cream",
    name: "Espresso & Cream",
    description: "Dark coffee and a warm, light workspace.",
    swatches: ["#f4ede3", "#76503c", "#271b16"],
    navDark: true,
  },
  {
    id: "harbour",
    name: "Harbour",
    description: "Deep navy beside a bright coastal workspace.",
    swatches: ["#edf4f7", "#1c6571", "#132837"],
    navDark: true,
  },
  {
    id: "ink-paper",
    name: "Ink & Paper",
    description: "Dark ink and a clean paper canvas.",
    swatches: ["#f6f5f1", "#4f4d85", "#202331"],
    navDark: true,
  },
  {
    id: "moonlight",
    name: "Moonlight",
    description: "A dark workspace with light, warm navigation.",
    swatches: ["#141d24", "#8cbba8", "#f6f2e9"],
    dark: true,
    navDark: false,
  },
  {
    id: "alpine-mint",
    name: "Alpine Mint",
    description: "Deep evergreen navigation with a crisp mint workspace.",
    swatches: ["#f2f7f4", "#1b5e43", "#12221b"],
    navDark: true,
  },
  {
    id: "sandstone-slate",
    name: "Sandstone & Slate",
    description: "Deep slate navigation beside a sunlit sandstone workspace.",
    swatches: ["#f7f3ee", "#82552f", "#1c2024"],
    navDark: true,
  },
  {
    id: "nordic-frost",
    name: "Nordic Frost",
    description: "Midnight fjord navigation with a bright arctic workspace.",
    swatches: ["#f0f4f8", "#1d5f8a", "#0e1722"],
    navDark: true,
  },
  {
    id: "solar-dark",
    name: "Solar Dark",
    description: "An obsidian night workspace with warm parchment navigation.",
    swatches: ["#15171c", "#e6a838", "#f9f5ec"],
    dark: true,
    navDark: false,
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
  "--nav-bg",
  "--nav-ink",
  "--nav-ink-secondary",
  "--nav-muted",
  "--nav-line",
  "--nav-panel-soft",
  "--nav-panel-hover",
  "--nav-accent",
  "--nav-accent-soft",
  "--nav-on-accent",
  "--nav-focus",
  "--nav-selection",
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
  // Mixed themes use separately toned navigation so one accent can remain
  // readable on a dark sidebar and a light workspace (or vice versa).
  const navDark = THEMES.find((t) => t.id === theme)?.navDark;
  if (navDark !== undefined && isHex(bases["--nav-bg"])) {
    const navSurfaces = ["--nav-bg", "--nav-panel-soft", "--nav-panel-hover"];
    if (background) {
      for (const name of [
        ...navSurfaces,
        "--nav-accent-soft",
        "--nav-selection",
      ])
        if (isHex(bases[name])) root.style.setProperty(name, tint(bases[name]));
      for (const name of ["--nav-ink", "--nav-ink-secondary", "--nav-muted"]) {
        const original = bases[name];
        if (!isHex(original)) continue;
        let adjusted = original;
        for (let i = 0; i <= 100; i++) {
          adjusted = mix(original, navDark ? "#ffffff" : "#000000", i / 100);
          if (
            navSurfaces.every(
              (surface) =>
                !isHex(bases[surface]) ||
                contrast(adjusted, tint(bases[surface])) + 0.000001 >=
                  Math.min(4.5, contrast(original, bases[surface])),
            )
          )
            break;
        }
        root.style.setProperty(name, adjusted);
      }
    }
    const navSelected =
      customAccent || (background ? bases["--nav-accent"] : "");
    if (isHex(navSelected)) {
      const navPanel = tint(bases["--nav-panel-soft"]);
      let accent = navSelected;
      for (let i = 0; i <= 100; i++) {
        accent = mix(navSelected, navDark ? "#ffffff" : "#000000", i / 100);
        if (
          navSurfaces.every(
            (name) =>
              !isHex(bases[name]) || contrast(accent, tint(bases[name])) >= 4.5,
          ) &&
          (!isHex(navPanel) ||
            contrast(accent, mix(navPanel, accent, 0.05)) >= 4.5)
        )
          break;
      }
      root.style.setProperty("--nav-accent", accent);
      root.style.setProperty(
        "--nav-on-accent",
        contrast(accent, "#ffffff") >= contrast(accent, "#151515")
          ? "#ffffff"
          : "#151515",
      );
      root.style.setProperty("--nav-focus", accent);
      if (isHex(navPanel)) {
        root.style.setProperty(
          "--nav-accent-soft",
          mix(navPanel, accent, 0.05),
        );
        root.style.setProperty("--nav-selection", mix(navPanel, accent, 0.24));
      }
    }
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
  const [name, setName] = useState(profile.name);
  const [revision, setRevision] = useState(profile.revision);
  const [image, setImage] = useState("");
  const [preview, setPreview] = useState("");
  const [remove, setRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [undoStack, setUndoStack] = useState<{ name: string; avatarUrl?: string }[]>([]);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "undone" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("");

  const nameRef = useRef(name);
  nameRef.current = name;
  const lastSavedNameRef = useRef(profile.name);
  const revisionRef = useRef(profile.revision);
  revisionRef.current = revision;
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef(false);

  useEffect(() => {
    setName(profile.name);
    setRevision(profile.revision);
    lastSavedNameRef.current = profile.name;
  }, [profile.name, profile.revision]);

  const performSave = useCallback(
    async (
      targetName: string,
      customImage?: string,
      customRemove?: boolean,
      isUndo = false,
      priorSnapshot?: { name: string; avatarUrl?: string },
    ) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (
        !isUndo &&
        !customImage &&
        !customRemove &&
        targetName.trim() === lastSavedNameRef.current.trim()
      ) {
        return;
      }
      if (isSavingRef.current) return;
      isSavingRef.current = true;
      setBusy(true);
      setError("");
      setSaveStatus("saving");

      const prior = priorSnapshot || { name: lastSavedNameRef.current, avatarUrl: profile.avatarUrl };
      try {
        const next = await api<Profile>(
          "/profile",
          json(
            {
              revision: revisionRef.current,
              name: targetName,
              ...(customImage ? { imageBase64: customImage } : {}),
              ...(customRemove ? { removeAvatar: true } : {}),
            },
            "PATCH",
          ),
        );
        onSaved(next);
        setConflict(false);
        setRevision(next.revision);
        lastSavedNameRef.current = next.name;
        setImage("");
        setPreview("");
        setRemove(false);
        if (!isUndo) {
          setUndoStack((prev) => [...prev.slice(-19), prior]);
          setSaveStatus("saved");
          setStatusMessage("Profile saved");
        } else {
          setSaveStatus("undone");
          setStatusMessage("Undid last change");
        }
      } catch (e) {
        setSaveStatus("error");
        setStatusMessage("Could not save profile");
        setError(
          e instanceof Error ? e.message : "Your profile could not be saved.",
        );
        if (e instanceof ApiError && e.status === 401) onError(e);
        if (e instanceof ApiError && e.status === 409) setConflict(true);
      } finally {
        isSavingRef.current = false;
        setBusy(false);
      }
    },
    [profile.avatarUrl, onSaved, onError],
  );

  const scheduleSave = useCallback(
    (targetName: string, delay = 600) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      setSaveStatus("saving");
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void performSave(targetName);
      }, delay);
    },
    [performSave],
  );

  const handleBlur = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      void performSave(nameRef.current);
    }
  }, [performSave]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        void performSave(nameRef.current);
      }
    };
  }, [performSave]);

  const handleUndo = useCallback(async () => {
    if (undoStack.length === 0 || busy || isSavingRef.current) return;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setName(previous.name);
    await performSave(previous.name, undefined, !previous.avatarUrl && Boolean(profile.avatarUrl), true);
  }, [undoStack, busy, profile.avatarUrl, performSave]);

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
      const b64 = data.split(",")[1];
      setImage(b64);
      setRemove(false);
      void performSave(nameRef.current, b64);
    };
    reader.onerror = () => setError("The photo could not be read.");
    reader.readAsDataURL(file);
  }

  const handleRemovePhoto = () => {
    setRemove(true);
    setPreview("");
    setImage("");
    void performSave(nameRef.current, undefined, true);
  };

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
            A name and photo to make Opportunity Knox feel like your workspace. Changes save automatically.
          </p>
        </div>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void performSave(nameRef.current); }}>
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
                onClick={handleRemovePhoto}
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
              scheduleSave(e.target.value, 600);
            }}
            onBlur={handleBlur}
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
                setConflict(false);
                setError("");
                onNotice("Latest profile loaded.");
              } catch (e) {
                onError(e);
              }
            }}
          >
            Reload latest profile
          </button>
        )}
        <div className="auto-save-bar">
          <div className="auto-save-status" role="status" aria-live="polite">
            {saveStatus === "saving" && (
              <span className="status-saving">
                <LoaderCircle size={14} className="spin" />
                <span>Saving…</span>
              </span>
            )}
            {saveStatus === "saved" && (
              <span className="status-saved">
                <Check size={14} />
                <span>{statusMessage || "Profile saved"}</span>
              </span>
            )}
            {saveStatus === "undone" && (
              <span className="status-undone">
                <RotateCcw size={14} />
                <span>{statusMessage || "Undid last change"}</span>
              </span>
            )}
            {saveStatus === "error" && (
              <span className="status-error">
                <AlertCircle size={14} />
                <span>{statusMessage || "Could not save profile"}</span>
              </span>
            )}
          </div>
          <button
            type="button"
            className="button secondary small undo-button"
            disabled={undoStack.length === 0 || saveStatus === "saving" || busy}
            onClick={() => void handleUndo()}
            title="Undo last change (Cmd+Z or Ctrl+Z)"
          >
            <RotateCcw size={13} />
            Undo last change
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
  failed,
  dirty,
}: {
  appearance: Appearance;
  onChange: (patch: Partial<Appearance>) => void;
  onSave: () => void;
  onReset: () => void;
  saving: boolean;
  failed: boolean;
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
            Choose a theme and make it yours. Changes save automatically across
            devices.
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
            Accent shades are adjusted for readability; background colour adds a
            subtle tint.
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
              />{" "}
              <span>{appearance.themeAccent || "Theme default"}</span>
            </div>
            {appearance.themeAccent && (
              <button
                className="text-button"
                type="button"
                onClick={() => onChange({ themeAccent: "" })}
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
              />{" "}
              <span>{appearance.themeBackground || "Theme default"}</span>
            </div>
            {appearance.themeBackground && (
              <button
                className="text-button"
                type="button"
                onClick={() => onChange({ themeBackground: "" })}
              >
                Use theme background
              </button>
            )}
          </div>
        </div>
        <div className="theme-save-row">
          <button
            className="button secondary"
            type="button"
            onClick={onReset}
            disabled={!appearance.themeAccent && !appearance.themeBackground}
          >
            Reset colours
          </button>
          {failed && (
            <button className="button primary" type="button" onClick={onSave}>
              Retry saving
            </button>
          )}
          <small role="status">
            {failed
              ? "Could not save appearance. Retry saving."
              : saving || dirty
                ? "Saving appearance…"
                : "Appearance saved across devices."}
          </small>
        </div>
      </div>
    </section>
  );
}
