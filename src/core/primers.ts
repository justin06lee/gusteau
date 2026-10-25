import designElements from "../../primers/design-elements.md" with { type: "text" };
import designPrinciples from "../../primers/design-principles.md" with { type: "text" };
import typographyBasics from "../../primers/typography-basics.md" with { type: "text" };
import colorTheoryBasics from "../../primers/color-theory-basics.md" with { type: "text" };
import layoutGrids from "../../primers/layout-grids.md" with { type: "text" };
import uxBasics from "../../primers/ux-basics.md" with { type: "text" };

export const PRIMERS: Record<string, string> = {
  "design-elements": designElements,
  "design-principles": designPrinciples,
  "typography-basics": typographyBasics,
  "color-theory-basics": colorTheoryBasics,
  "layout-grids": layoutGrids,
  "ux-basics": uxBasics,
};

/** A primer by full name or its first word ("ux", "color"). */
export function primer(name: string): string | null {
  const key = Object.keys(PRIMERS).find((k) => k === name || k.split("-")[0] === name.toLowerCase());
  return key ? PRIMERS[key]! : null;
}

/** The lines after "Before calling a design done:" in each primer. */
export function quickChecks(): string[] {
  return Object.values(PRIMERS).flatMap((text) => {
    const after = text.split("Before calling a design done:")[1] ?? "";
    return after.split("\n").map((l) => l.trim()).filter(Boolean);
  });
}
