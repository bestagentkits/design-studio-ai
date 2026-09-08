import type { KeyboardEvent } from "react";

/** Select sibling choices without letting their navigation keys reach canvas shortcuts. */
export function navigateButtonGroup(
  event: KeyboardEvent<HTMLElement>,
  selector = ":scope > button",
  orientation: "horizontal" | "vertical" | "auto" = "horizontal",
) {
  if (
    event.defaultPrevented || event.nativeEvent.isComposing ||
    event.altKey || event.ctrlKey || event.metaKey
  ) return;
  const vertical =
    orientation === "vertical" ||
    (orientation === "auto" &&
      getComputedStyle(event.currentTarget).flexDirection === "column");
  const previous = vertical ? "ArrowUp" : "ArrowLeft";
  const following = vertical ? "ArrowDown" : "ArrowRight";
  if (![previous, following, "Home", "End"].includes(event.key)) return;
  const buttons = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>(selector),
  ).filter(button => !button.disabled && button.getClientRects().length > 0);
  const target =
    event.target instanceof Element ? event.target.closest("button") : null;
  const index = target ? buttons.indexOf(target) : -1;
  if (index < 0) return;
  event.preventDefault();
  event.stopPropagation();
  let nextIndex = index + (event.key === following ? 1 : -1);
  if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = buttons.length - 1;
  nextIndex = Math.max(0, Math.min(buttons.length - 1, nextIndex));
  const next = buttons[nextIndex]!;
  if (nextIndex === index && next.getAttribute("aria-pressed") === "true") return;
  next.click();
  next.focus({ preventScroll: true });
  next.scrollIntoView({ block: "nearest", inline: "nearest" });
}
