import { existsSync, mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { summarizeTokens } from "./brief";
import { LEVELS } from "./components";
import { loadRules } from "./rules";
import { projectDir, writeJson, writeText, writeYaml } from "./store";
import { generateTokens, remember, type Tokens } from "./tokens";

export type InitResult = { dir: string; tokens: Tokens };

/** Set up a project's sheet from the global rules and the user's request. */
export function initProject(root: string, request: string, opts: { name?: string; force?: boolean } = {}): InitResult {
  root = resolve(root);
  const dir = projectDir(root);
  if (existsSync(join(dir, "tokens.json")) && !opts.force) throw new Error(`${dir} already has tokens; pass --force to replace them`);
  const name = opts.name ?? basename(root);
  const tokens = generateTokens(name, request, loadRules(), root);

  writeJson(join(dir, "tokens.json"), tokens);
  writeText(join(dir, "DESIGN.md"), [
    `# ${name}`, "",
    "## Goal", "", request.trim(), "",
    "## Principles", "",
    "- One main action per screen, and it is the most visible thing on it.",
    "- Hierarchy comes from size, weight and space before color.",
    "- The accent marks what should stand out, nothing else.", "",
    "## Tokens", "", summarizeTokens(tokens), "",
  ].join("\n"));
  writeText(join(dir, "DECISIONS.md"), "# Decisions\n\nEach entry: `## <title>`, then `Status:` and `Id:` lines, then `**Why:**` and `**Instead of:**` paragraphs.\n");
  writeJson(join(dir, "review.json"), { items: {} });
  writeYaml(join(dir, "prefs.yaml"), []);
  for (const l of LEVELS) mkdirSync(join(dir, "components", l), { recursive: true });

  remember({ project: name, root, fonts: [tokens.font.heading, tokens.font.body, tokens.font.mono], accentHue: hueOf(tokens.color.accent), at: new Date().toISOString() });
  return { dir, tokens };
}

function hueOf(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round((h * 60 + 360) % 360);
}
