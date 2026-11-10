import { useEffect, useState } from "react";

export type BuddyAvatarId = "sunny" | "sage" | "nova" | "pip" | "atlas" | "milo";

export type BuddyAvatarOption = {
  id: BuddyAvatarId;
  name: string;
  tagline: string;
  bg: string;
  accent: string;
};

export const BUDDY_AVATARS: BuddyAvatarOption[] = [
  {
    id: "sunny",
    name: "Sunny",
    tagline: "Warm & encouraging smile",
    bg: "#fef3c7",
    accent: "#d97706",
  },
  {
    id: "sage",
    name: "Sage",
    tagline: "Thoughtful mentor with glasses",
    bg: "#dcfce7",
    accent: "#15803d",
  },
  {
    id: "nova",
    name: "Nova",
    tagline: "Cheerful star-eyed coach",
    bg: "#e0e7ff",
    accent: "#4338ca",
  },
  {
    id: "pip",
    name: "Pip",
    tagline: "Friendly bot companion",
    bg: "#ccfbf1",
    accent: "#0f766e",
  },
  {
    id: "atlas",
    name: "Atlas",
    tagline: "Calm & steady strategist",
    bg: "#f3e8ff",
    accent: "#7e22ce",
  },
  {
    id: "milo",
    name: "Milo",
    tagline: "Upbeat & curious friend",
    bg: "#ffe4e6",
    accent: "#be123c",
  },
];

const STORAGE_KEY = "knox-buddy-avatar";
const AVATAR_EVENT = "knox-buddy-avatar-change";

export function getSavedBuddyAvatar(): BuddyAvatarId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) as BuddyAvatarId | null;
    if (raw && BUDDY_AVATARS.some((a) => a.id === raw)) return raw;
  } catch {}
  return "sunny";
}

export function saveBuddyAvatar(id: BuddyAvatarId) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
    window.dispatchEvent(new CustomEvent(AVATAR_EVENT, { detail: id }));
  } catch {}
}

export function useBuddyAvatar(): [BuddyAvatarId, (id: BuddyAvatarId) => void] {
  const [avatar, setAvatarState] = useState<BuddyAvatarId>(() =>
    getSavedBuddyAvatar(),
  );

  useEffect(() => {
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent<BuddyAvatarId>).detail;
      if (detail && BUDDY_AVATARS.some((a) => a.id === detail)) {
        setAvatarState(detail);
      } else {
        setAvatarState(getSavedBuddyAvatar());
      }
    };
    window.addEventListener(AVATAR_EVENT, onUpdate);
    window.addEventListener("storage", onUpdate);
    return () => {
      window.removeEventListener(AVATAR_EVENT, onUpdate);
      window.removeEventListener("storage", onUpdate);
    };
  }, []);

  const setAvatar = (id: BuddyAvatarId) => {
    setAvatarState(id);
    saveBuddyAvatar(id);
  };

  return [avatar, setAvatar];
}

export function BuddyAvatar({
  avatarId,
  variant,
  size = 24,
  className = "",
}: {
  avatarId?: BuddyAvatarId;
  variant?: BuddyAvatarId;
  size?: number;
  className?: string;
}) {
  const [savedId] = useBuddyAvatar();
  const activeId = variant || avatarId || savedId;
  const meta =
    BUDDY_AVATARS.find((a) => a.id === activeId) || BUDDY_AVATARS[0];

  return (
    <span
      className={`buddy-face-avatar buddy-face-${meta.id} ${className}`.trim()}
      style={{
        width: size,
        height: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        flexShrink: 0,
      }}
      title={`Career Buddy (${meta.name})`}
      aria-hidden="true"
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle
          cx="18"
          cy="18"
          r="17"
          fill={meta.bg}
          stroke={meta.accent}
          strokeWidth="2"
        />
        {meta.id === "sunny" && (
          <>
            {/* Rosy cheeks */}
            <circle cx="10.5" cy="20.5" r="2.2" fill="#f59e0b" fillOpacity="0.35" />
            <circle cx="25.5" cy="20.5" r="2.2" fill="#f59e0b" fillOpacity="0.35" />
            {/* Happy eyes */}
            <circle cx="13" cy="15.5" r="2" fill="#78350f" />
            <circle cx="23" cy="15.5" r="2" fill="#78350f" />
            {/* Warm smile */}
            <path
              d="M12.5 21C14 23.8 22 23.8 23.5 21"
              stroke="#78350f"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
            {/* Little hair tuft */}
            <path
              d="M16 4.5C17.5 2.5 20.5 3 20 6"
              stroke={meta.accent}
              strokeWidth="2"
              strokeLinecap="round"
            />
          </>
        )}

        {meta.id === "sage" && (
          <>
            {/* Round glasses */}
            <circle
              cx="13"
              cy="15.5"
              r="3.8"
              stroke="#14532d"
              strokeWidth="1.8"
              fill="#ffffff"
              fillOpacity="0.6"
            />
            <circle
              cx="23"
              cy="15.5"
              r="3.8"
              stroke="#14532d"
              strokeWidth="1.8"
              fill="#ffffff"
              fillOpacity="0.6"
            />
            <line
              x1="16.8"
              y1="15.5"
              x2="19.2"
              y2="15.5"
              stroke="#14532d"
              strokeWidth="1.8"
            />
            <circle cx="13" cy="15.5" r="1.5" fill="#14532d" />
            <circle cx="23" cy="15.5" r="1.5" fill="#14532d" />
            {/* Gentle confident smile */}
            <path
              d="M13.5 22.2C15.2 24 20.8 24 22.5 22.2"
              stroke="#14532d"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </>
        )}

        {meta.id === "nova" && (
          <>
            {/* Happy arc eyes */}
            <path
              d="M10.5 16C11.5 13.8 14.5 13.8 15.5 16"
              stroke="#312e81"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
            <path
              d="M20.5 16C21.5 13.8 24.5 13.8 25.5 16"
              stroke="#312e81"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
            {/* Cheek blush */}
            <circle cx="10" cy="19.5" r="2" fill="#6366f1" fillOpacity="0.3" />
            <circle cx="26" cy="19.5" r="2" fill="#6366f1" fillOpacity="0.3" />
            {/* Big cheerful grin */}
            <path
              d="M12.5 20.5C14 24.5 22 24.5 23.5 20.5Z"
              fill="#4338ca"
            />
            {/* Sparkle */}
            <path
              d="M27 8L28 10L30 11L28 12L27 14L26 12L24 11L26 10L27 8Z"
              fill="#4338ca"
            />
          </>
        )}

        {meta.id === "pip" && (
          <>
            {/* Antenna */}
            <line
              x1="18"
              y1="4"
              x2="18"
              y2="8"
              stroke="#0f766e"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <circle cx="18" cy="4" r="2" fill="#0f766e" />
            {/* Visor / friendly robot face */}
            <rect
              x="8.5"
              y="11.5"
              width="19"
              height="9"
              rx="4.5"
              fill="#ffffff"
              stroke="#0f766e"
              strokeWidth="1.8"
            />
            <circle cx="13.5" cy="16" r="1.8" fill="#0f766e" />
            <circle cx="22.5" cy="16" r="1.8" fill="#0f766e" />
            {/* Friendly smile */}
            <path
              d="M14 24C15.5 25.8 20.5 25.8 22 24"
              stroke="#0f766e"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </>
        )}

        {meta.id === "atlas" && (
          <>
            {/* Friendly eyebrows */}
            <path
              d="M10.5 12.5C12 11.5 14 11.5 15.5 12.5"
              stroke="#581c87"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <path
              d="M20.5 12.5C22 11.5 24 11.5 25.5 12.5"
              stroke="#581c87"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <circle cx="13" cy="16" r="2" fill="#581c87" />
            <circle cx="23" cy="16" r="2" fill="#581c87" />
            {/* Calm warm smile */}
            <path
              d="M13 22C15 24.2 21 24.2 23 22"
              stroke="#581c87"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </>
        )}

        {meta.id === "milo" && (
          <>
            {/* Playful wink & eye */}
            <circle cx="13" cy="15.5" r="2.1" fill="#881337" />
            <path
              d="M20.5 15.5C21.5 13.8 24 13.8 25 15.5"
              stroke="#881337"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
            <circle cx="10" cy="20" r="2.2" fill="#f43f5e" fillOpacity="0.3" />
            <circle cx="26" cy="20" r="2.2" fill="#f43f5e" fillOpacity="0.3" />
            {/* Upbeat smile */}
            <path
              d="M12.5 20.8C14.5 24.2 21.5 24.2 23.5 20.8"
              stroke="#881337"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </>
        )}
      </svg>
    </span>
  );
}

export default BuddyAvatar;
