import { join } from "node:path";
import { LEVELS, loadComponents } from "./components";
import { parseDecisions, effectivePrefs, type Pref } from "./prefs";
import { quickChecks } from "./primers";
import { loadRules } from "./rules";
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

/** Quick checks that say again what a rule already says. */
const RESTATES: Record<string, RegExp> = {
  "type.families": /fonts or fewer/i,
  "type.body": /body text big enough/i,
  "type.measure": /lines not too long/i,
  "color.contrast": /contrast|easy to read on its background|value difference/i,
  "color.accent": /accent color/i,
  "ux.goal": /main goal/i,
  "ux.feedback": /every click/i,
};

const prefLine = (p: Pref) => `- ${p.says}${p.why ? ` (${p.why})` : ""}${p.strength === "hard" ? " [hard]" : ""}`;

/** The compact context an agent reads at task time. Only what applies here, nothing about elsewhere. */
export function compileBrief(root = process.cwd()): string {
  const dir = projectDir(root);
  const design = readText(join(dir, "DESIGN.md")) ?? "";
  const tokens = loadTokens(root);
  const { global, project } = effectivePrefs(root);
  const decisions = parseDecisions(readText(join(dir, "DECISIONS.md")) ?? "").filter((d) => /accept/i.test(d.status));
  const components = loadComponents(root);
  const out: string[] = ["# Design brief"];
  const add = (title: string, lines: string[]) => lines.length && out.push("", `## ${title}`, ...lines);

  const goal = section(design, "Goal");
  add("Goal", goal ? [goal] : []);
  const rules = loadRules();
  const restated = rules.map((r) => RESTATES[r.id]).filter((re): re is RegExp => !!re);
  add("Rules", rules.map((r) => `- ${r.says}`));
  add("Taste", global.map(prefLine));
  add("This project", [
    ...(tokens ? [`- Tokens in .gusteau/tokens.json: ${summarizeTokens(tokens)}. Every size, color and duration comes from there.`] : []),
    ...decisions.map((d) => `- ${d.title}${d.why ? ` (${d.why})` : ""}`),
    ...project.map(prefLine),
    ...LEVELS.flatMap((l) => {
      const names = components.filter((c) => c.level === l).map((c) => c.name);
      return names.length ? [`- ${l}s: ${names.join(", ")}`] : [];
    }),
  ]);
  add("Before calling it done", quickChecks().filter((l) => !restated.some((re) => re.test(l))).map((l) => `- ${l}`));
  add("Tools", [
    "- `gusteau check` lists what's off; fix the top item and run it again until it passes. A value chosen on purpose (a brand logo's colors, an OG image's sizes) gets a `gusteau-ignore` comment on its line, or `gusteau-ignore-start` / `-end` around a block.",
    "- When the user approves or corrects a design choice, record it in their words with `gusteau learn --says \"...\" --why \"...\"`.",
    "- When the request names another company's or product's look, `gusteau ref <name>` returns its saved sheet; if there is none, research that design and save one with `gusteau ref save <name> <file>` (`gusteau ref template` prints the outline).",
    "- `gusteau component search <words>` finds pieces already built; `gusteau component add` records a new one.",
    "- `gusteau primer <name>` prints a full primer (elements, principles, typography, color, layout, ux).",
  ]);
  return out.join("\n") + "\n";
}
