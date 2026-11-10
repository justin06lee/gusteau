import { join } from "node:path";
import { LEVELS, loadComponents } from "./components";
import { KIND_NOTES, loadKind, rulesFor, type Kind } from "./kind";
import { parseDecisions, effectivePrefs, type Pref } from "./prefs";
import { effectiveRejections, type Rejection } from "./rejections";
import { DEFAULT_RULES, loadRules, type Rule } from "./rules";
import { projectDir, readText } from "./store";
import { loadTokens, type Tokens } from "./tokens";

/** One markdown section of a design doc, by heading. */
export function section(md: string, heading: string): string {
  const m = md.match(new RegExp(`^##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, "mi"));
  return m ? m[1]!.trim() : "";
}

export function summarizeTokens(t: Tokens): string {
  return [
    `fonts ${t.font.heading} / ${t.font.body} / ${t.font.mono}`,
    `accent ${t.color.accent} on ${t.color.bg}`,
    `type ${t.type.scale.join(" ")} (ratio ${t.type.ratio})`,
    `space ${t.space.join(" ")}`,
    `radius ${t.radius.sm} ${t.radius.md} ${t.radius.lg}`,
    `motion ${t.motion.fast} ${t.motion.base} ${t.motion.slow}ms`,
  ].join("; ");
}

const prefLine = (p: Pref) => `- ${p.says}${p.why ? ` (${p.why})` : ""}${p.strength === "hard" ? " [hard]" : ""}`;
const rejectionLine = (r: Rejection) =>
  `- ${r.tried}${r.said ? `: "${r.said}"` : ""}${r.instead ? `. Went with: ${r.instead}` : ""}${r.when ? ` (${r.when})` : ""}`;

/** The default rules' limits in one line; the rest of the default rules are design basics an agent already knows. */
const LIMITS: Record<string, (r: Rule) => string> = {
  "spacing.grid": (r) => `${r.step}px grid`,
  "type.families": (r) => `${r.max} font families at most`,
  "type.body": (r) => `body ≥${r.min}px`,
  "type.leading": (r) => `line height ${r.min}–${r.max}`,
  "type.measure": (r) => `lines ${r.min}–${r.max} characters`,
  "color.contrast": (r) => `contrast ≥${r.min}:1`,
  "color.accent": (r) => (r.max === 1 ? "one accent" : `${r.max} accents at most`),
  "motion.duration": (r) => `transitions ${r.min}–${r.max}ms`,
  "touch.target": (r) => `tap targets ≥${r.min}px`,
};
const BASICS = new Set(DEFAULT_RULES.map((r) => r.id));

function summarize(t: Tokens, kind: Kind): string {
  if (kind !== "terminal") return summarizeTokens(t);
  return `accent ${t.color.accent} on ${t.color.bg}; text ${t.color.text}, muted ${t.color.muted}`;
}

/** The compact context an agent reads at task time: the user's taste first, then this project, then limits. Nothing about elsewhere. */
export function compileBrief(root = process.cwd()): string {
  const dir = projectDir(root);
  const design = readText(join(dir, "DESIGN.md")) ?? "";
  const tokens = loadTokens(root);
  const kind = loadKind(root);
  const { global, project } = effectivePrefs(root, kind);
  const rejections = effectiveRejections(root, kind);
  const decisions = parseDecisions(readText(join(dir, "DECISIONS.md")) ?? "").filter((d) => /accept/i.test(d.status));
  const components = loadComponents(root);
  const rules = rulesFor(loadRules(), kind);
  const out: string[] = ["# Design brief"];
  const add = (title: string, lines: string[]) => lines.length && out.push("", `## ${title}`, ...lines);

  const goal = section(design, "Goal");
  add("Goal", [...(goal ? [goal] : []), `Kind: ${kind}. ${KIND_NOTES[kind]}`]);
  add("Taste", global.map(prefLine));
  add("This project", [
    ...project.map(prefLine),
    ...decisions.map((d) => `- ${d.title}${d.why ? ` (${d.why})` : ""}`),
    ...(tokens ? [`- Tokens in .gusteau/tokens.json: ${summarize(tokens, kind)}. Every ${kind === "terminal" ? "color" : "size, color and duration"} comes from there.`] : []),
    ...LEVELS.flatMap((l) => {
      const names = components.filter((c) => c.level === l).map((c) => c.name);
      return names.length ? [`- ${l}s: ${names.join(", ")}`] : [];
    }),
  ]);
  add("Tried and turned down", rejections.map(rejectionLine));
  const limits = rules.flatMap((r) => (LIMITS[r.id] && (r.min ?? r.max ?? r.step) != null ? [LIMITS[r.id]!(r)] : []));
  add("Limits", [
    ...(limits.length ? [limits.join(" · ")] : []),
    ...rules.filter((r) => !BASICS.has(r.id)).map((r) => `- ${r.says}`),
  ]);
  add("Tools", [
    "- `gusteau check` lists what's off; fix the top item and run it again until it passes. A value chosen on purpose (a brand logo's colors, an OG image's sizes) gets a `gusteau-ignore` comment on its line, or `gusteau-ignore-start` / `-end` around a block.",
    "- When the user approves or corrects a design choice, record it in their words with `gusteau learn --says \"...\" --why \"...\"`; when they turn something down, `gusteau reject --tried \"...\" --said \"...\" --instead \"...\"`.",
    "- When the request names another company's or product's look, `gusteau ref <name>` returns its saved sheet; if there is none, research that design and save one with `gusteau ref save <name> <file>` (`gusteau ref template` prints the outline).",
    "- `gusteau component search <words>` finds pieces already built; `gusteau component add` records a new one. `gusteau primer <name>` has the design basics.",
  ]);
  return out.join("\n") + "\n";
}
