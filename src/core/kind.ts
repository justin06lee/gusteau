import { join } from "node:path";
import type { Rule } from "./rules";
import { projectDir, readYaml, writeYaml } from "./store";

/** What a project is decides which rules bend: its theme, not a global default. */
export type Kind = "product" | "marketing" | "terminal";
export const KINDS: Kind[] = ["product", "marketing", "terminal"];

export const KIND_NOTES: Record<Kind, string> = {
  product: "A product screen: restraint applies in full.",
  marketing: "A marketing site: atmosphere is allowed (illustration, texture, depth, motion for mood). Readability and contrast still hold.",
  terminal: "A terminal app: sizes are cells and the font is the terminal's. Contrast, one accent and one goal per screen still hold.",
};

/** Rules that don't apply to a kind, unless a rule lists its own `kinds`. */
const BENDS: Record<Kind, string[]> = {
  product: [],
  marketing: [],
  terminal: ["spacing.grid", "type.families", "type.body", "type.leading", "shape.radius", "motion.duration", "touch.target"],
};

export const appliesTo = (r: { id?: string; kinds?: Kind[] }, kind: Kind) =>
  r.kinds?.length ? r.kinds.includes(kind) : !BENDS[kind].includes(r.id ?? "");
export const rulesFor = (rules: Rule[], kind: Kind) => rules.filter((r) => appliesTo(r, kind));

const path = (root?: string) => join(projectDir(root), "project.yaml");

/** The project's declared kind; projects that never declared one are products. */
export function loadKind(root?: string): Kind {
  const k = readYaml<{ kind?: string }>(path(root), {}).kind;
  return KINDS.includes(k as Kind) ? (k as Kind) : "product";
}
export function saveKind(kind: Kind, root?: string) {
  writeYaml(path(root), { ...readYaml<object>(path(root), {}), kind });
}

/** The kind a request implies: "a TUI for…" is a terminal app, "a landing page" is marketing. */
export function kindFrom(request: string): Kind {
  if (/\b(tui|terminal|cli|command[- ]line|console app|ncurses|ratatui)\b/i.test(request)) return "terminal";
  if (/\b(landing page|marketing|homepage for|launch page|brochure|promo|portfolio)\b/i.test(request)) return "marketing";
  return "product";
}
