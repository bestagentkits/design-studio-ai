import { useId, useRef, useState, useSyncExternalStore } from "react";
import { Check, ChevronDown, Monitor, Moon, Sun } from "lucide-react";

type Appearance = "system" | "light" | "dark";
const storageKey = "design-studio:appearance";
const choices = [
  {
    value: "system",
    label: "System",
    description: "Follow your device",
    icon: Monitor,
  },
  {
    value: "light",
    label: "Light",
    description: "A light workspace",
    icon: Sun,
  },
  { value: "dark", label: "Dark", description: "A dark workspace", icon: Moon },
] as const;
let preference: Appearance = "system";
let systemTheme: MediaQueryList | undefined;
let initialized = false;
const listeners = new Set<() => void>();

function readPreference(): Appearance {
  try {
    const value = localStorage.getItem(storageKey);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}
function applyAppearance() {
  const resolved =
    preference === "system"
      ? systemTheme?.matches
        ? "dark"
        : "light"
      : preference;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.appearancePreference = preference;
  document.documentElement.style.colorScheme = resolved;
}
function notify() {
  for (const listener of listeners) listener();
}

/** Call before mounting React. The early HTML script uses the same storage key. */
export function initializeTheme() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  systemTheme = matchMedia("(prefers-color-scheme: dark)");
  preference = readPreference();
  applyAppearance();
  systemTheme.addEventListener("change", () => {
    if (preference === "system") applyAppearance();
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== storageKey && event.key !== null) return;
    preference = readPreference();
    applyAppearance();
    notify();
  });
}
function setAppearance(value: Appearance) {
  initializeTheme();
  preference = value;
  try {
    localStorage.setItem(storageKey, value);
  } catch {
    /* This session still follows the selected preference. */
  }
  applyAppearance();
  notify();
}
function subscribe(listener: () => void) {
  initializeTheme();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function ThemeToggle({ compact = true }: { compact?: boolean }) {
  const value = useSyncExternalStore(
    subscribe,
    () => preference,
    () => "system" as Appearance,
  );
  const current = choices.find((choice) => choice.value === value)!;
  const id = useId(),
    menu = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false),
    [position, setPosition] = useState({ top: 0, left: 0 });
  if (!compact)
    return (
      <div
        className="appearance-options"
        role="group"
        aria-label="Appearance preference"
      >
        {choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            className={value === choice.value ? "selected" : ""}
            aria-pressed={value === choice.value}
            onClick={() => setAppearance(choice.value)}
          >
            <choice.icon size={19} aria-hidden="true" />
            <span>{choice.label}</span>
            {value === choice.value && <Check size={14} aria-hidden="true" />}
          </button>
        ))}
      </div>
    );
  return (
    <div className="appearance-picker">
      <button
        ref={trigger}
        type="button"
        className="appearance-trigger"
        popoverTarget={id}
        aria-label={`Appearance: ${current.label}`}
        title={`Appearance: ${current.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          if (!menu.current?.matches(":popover-open")) trigger.current?.click();
          const buttons =
            menu.current?.querySelectorAll<HTMLButtonElement>("button");
          buttons?.[event.key === "ArrowUp" ? buttons.length - 1 : 0]?.focus();
        }}
        onClick={() => {
          const rect = trigger.current!.getBoundingClientRect();
          setPosition({
            top: rect.bottom + 8,
            left: Math.max(8, Math.min(rect.left, innerWidth - 208)),
          });
        }}
      >
        <current.icon size={17} aria-hidden="true" />
        <span>{current.label}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      <div
        ref={menu}
        id={id}
        className="appearance-menu"
        popover="auto"
        role="menu"
        aria-label="Appearance preference"
        style={position}
        onToggle={(event) =>
          setOpen((event.nativeEvent as ToggleEvent).newState === "open")
        }
        onKeyDown={(event) => {
          const buttons = Array.from(
            menu.current!.querySelectorAll<HTMLButtonElement>("button"),
          );
          const index = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          let next = index;
          if (event.key === "ArrowDown") next = (index + 1) % buttons.length;
          else if (event.key === "ArrowUp")
            next =
              index < 0
                ? buttons.length - 1
                : (index - 1 + buttons.length) % buttons.length;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = buttons.length - 1;
          else return;
          event.preventDefault();
          buttons[next]?.focus();
        }}
      >
        {choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            role="menuitemradio"
            aria-checked={value === choice.value}
            aria-label={choice.label}
            onClick={() => {
              setAppearance(choice.value);
              menu.current?.hidePopover();
              trigger.current?.focus();
            }}
          >
            <choice.icon size={17} aria-hidden="true" />
            <span>
              <strong>{choice.label}</strong>
              <small>{choice.description}</small>
            </span>
            {value === choice.value && <Check size={15} aria-hidden="true" />}
          </button>
        ))}
      </div>
    </div>
  );
}
