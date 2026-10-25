import { join } from "node:path";
import { globalHome, readYaml, writeYaml } from "./store";

/** A global constraint. Projects choose values inside it. */
export type Rule = { id: string; says: string; min?: number; max?: number; step?: number; check?: "lint" | "tokens" | "components" };

export const DEFAULT_RULES: Rule[] = [
  { id: "values.tokens", says: "Every size and color in code comes from the tokens", check: "lint" },
  { id: "spacing.grid", says: "Spacing sits on a 4px grid", step: 4, check: "tokens" },
  { id: "type.families", says: "Two font families at most, one for headings and one for body", max: 2, check: "tokens" },
  { id: "type.body", says: "Body text is at least 16px", min: 16, check: "tokens" },
  { id: "type.leading", says: "Body line height between 1.4 and 1.7", min: 1.4, max: 1.7, check: "tokens" },
  { id: "type.measure", says: "Text lines run 50 to 75 characters", min: 50, max: 75 },
  { id: "color.contrast", says: "Text contrast is at least 4.5:1 on its background", min: 4.5, check: "tokens" },
  { id: "color.accent", says: "One accent color, kept for what should stand out", max: 1, check: "tokens" },
  { id: "shape.radius", says: "Matching parts share one radius; nested corners stay concentric", check: "components" },
  { id: "motion.duration", says: "Transitions take 120 to 320ms", min: 120, max: 320, check: "tokens" },
  { id: "touch.target", says: "Tap targets are at least 44px", min: 44, check: "tokens" },
  { id: "ux.goal", says: "Each screen serves one main goal" },
  { id: "ux.feedback", says: "Every action shows a response" },
];

const rulesPath = () => join(globalHome(), "rules.yaml");

export function loadRules(): Rule[] {
  const saved = readYaml<Rule[] | null>(rulesPath(), null);
  if (saved) return saved;
  writeYaml(rulesPath(), DEFAULT_RULES);
  return DEFAULT_RULES;
}
export const rule = (rules: Rule[], id: string) => rules.find((r) => r.id === id);
