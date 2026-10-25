import { relative, resolve } from "node:path";
import { normalizeHex } from "./color";
import { componentFailures, loadComponents } from "./components";
import { loadRules, type Rule } from "./rules";
import { readText, walk } from "./store";
import { type Failure, loadTokens, tokensPath, validateTokens } from "./tokens";

type Kind = "color" | "radius" | "type" | "space";
const SEVERITY: Record<Kind, number> = { color: 3, radius: 2, type: 2, space: 1 };
const EXT = /\.(css|scss|sass|less|html|vue|svelte|astro|jsx|tsx|js|ts|qml)$/;

const kindOf = (prop: string): Kind | null =>
  /radius/i.test(prop) ? "radius"
  : /font[-.]?(size|pixelSize|pointSize)|fontSize|line-?height|^text$|^leading$/i.test(prop) ? "type"
  : /^(padding|margin|gap|spacing|row-?gap|column-?gap|p[xytrbl]?|m[xytrbl]?|space-[xy])|padding|margins?$/i.test(prop) ? "space"
  : null;

/** Numbers and colors anywhere in a tokens object, with the first path each number sits at. */
export function flattenTokens(obj: unknown, out = { numbers: new Set<number>([0, 1]), colors: new Set<string>(), paths: new Map<number, string[]>() }, path = "") {
  const num = (n: number) => (out.numbers.add(n), out.paths.set(n, [...(out.paths.get(n) ?? []), path]));
  if (typeof obj === "number") num(obj);
  else if (typeof obj === "string") {
    const hex = obj.startsWith("#") && normalizeHex(obj);
    if (hex) out.colors.add(hex);
    for (const m of obj.matchAll(/(\d+(?:\.\d+)?)px/g)) num(+m[1]!);
  } else if (obj && typeof obj === "object")
    for (const [k, v] of Object.entries(obj)) if (k !== "default") flattenTokens(v, out, path ? `${path}.${k}` : k);
  return out;
}

export async function loadTokenSource(path?: string, root?: string): Promise<{ values: unknown; path: string } | null> {
  if (!path) {
    const t = loadTokens(root);
    return t && { values: t, path: tokensPath(root) };
  }
  const abs = resolve(path);
  if (abs.endsWith(".json")) return { values: JSON.parse(readText(abs)!), path: abs };
  return { values: await import(abs), path: abs };
}

const PATTERNS: { ext: RegExp; re: RegExp }[] = [
  // CSS-like declarations: `border-radius: 9px`, `padding: 5px 10px`
  { ext: /\.(css|scss|sass|less|html|vue|svelte|astro)$/, re: /(?<![\w-])((?:border-(?:[a-z]+-)*radius)|padding(?:-[a-z]+)?|margin(?:-[a-z]+)?|gap|row-gap|column-gap|font-size)\s*:\s*([^;{}\n]+)/g },
  // style objects: `borderRadius: 9`, `fontSize: "14px"`
  { ext: /\.(jsx|tsx|js|ts|vue|svelte|astro)$/, re: /\b(borderRadius|border\w+Radius|padding\w*|margin\w*|gap|rowGap|columnGap|fontSize)\s*:\s*(['"`]?\d+(?:\.\d+)?(?:px|rem)?['"`]?)/g },
  // tailwind arbitrary values: `rounded-[9px]`, `p-[5px]`, `text-[14px]`
  { ext: /\.(html|jsx|tsx|js|ts|vue|svelte|astro)$/, re: /\b(rounded(?:-[a-z]+)?|p[xytrbl]?|m[xytrbl]?|gap(?:-[xy])?|space-[xy]|text|leading)-\[(-?\d+(?:\.\d+)?(?:px|rem))\]/g },
  // QML literals: `radius: 9`, `font.pixelSize: 14`, `anchors.margins: 8`
  { ext: /\.qml$/, re: /\b(radius|spacing|padding|\w+Padding|(?:anchors\.)?\w*[mM]argins?|font\.pixelSize|font\.pointSize)\s*:\s*(-?\d+(?:\.\d+)?)\s*(?=[;\n}]|$)/g },
];
const HEX = /(?<=["'`:\s(,=])#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;

const KIND_PATH: Record<Kind, RegExp> = { color: /color/i, radius: /radius|corner|round/i, type: /type|font|text|leading/i, space: /space|gap|pad|margin|inset/i };
/** The token path for a value, preferring one named for the property's kind. */
const pathFor = (ps: string[], kind: Kind) => ps.find((p) => KIND_PATH[kind].test(p)) ?? ps[0];

const nearest = (n: number, set: Set<number>) => [...set].filter((v) => v > 1).reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a), Infinity);

/**
 * Hardcoded sizes and colors. Values that aren't tokens rank by kind; a literal that
 * copies a token's value ranks lowest (severity 0), since it drifts when the token changes.
 * Lines that define a value (QML properties, CSS custom properties) can repeat a token freely.
 */
export function lint(root: string, tokens: unknown, skip: string[] = []): Failure[] {
  const { numbers, colors, paths } = flattenTokens(tokens);
  const out: Failure[] = [];
  for (const file of walk(root).filter((f) => EXT.test(f) && !skip.includes(resolve(f)) && !/\.(test|spec|d)\.[jt]sx?$/.test(f))) {
    const lines = readText(file)!.split("\n");
    const rel = relative(root, file);
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      const defines = /\bproperty\s+\w+\s+\w+\s*:|^\s*--[\w-]+\s*:/.test(line);
      const where = `${rel}:${i + 1}`;
      for (const { ext, re } of PATTERNS) {
        if (!ext.test(file)) continue;
        for (const m of line.matchAll(re)) {
          const kind = kindOf(m[1]);
          if (!kind) continue;
          for (const v of m[2].matchAll(/(-?\d+(?:\.\d+)?)(px|rem)?/g)) {
            if (/var\(|calc\(|%|\bem\b|vh|vw|auto/.test(m[2]) && !v[2]) continue;
            const n = Math.abs(+v[1] * (v[2] === "rem" ? 16 : 1));
            if (numbers.has(n)) {
              if (n > 1 && !defines) out.push({ severity: 0, rule: "values.tokens", where, message: `${m[1]} ${v[0]} copies a token value`, fix: `reference ${pathFor(paths.get(n)!, kind)}` });
              continue;
            }
            const near = nearest(n, numbers);
            out.push({ severity: SEVERITY[kind], rule: "values.tokens", where, message: `${m[1]} ${v[0]} isn't a token`, fix: Number.isFinite(near) ? `nearest token is ${near}` : undefined });
          }
        }
      }
      for (const m of line.matchAll(HEX)) {
        const hex = normalizeHex(m[0]);
        if (hex && !colors.has(hex)) out.push({ severity: 3, rule: "values.tokens", where, message: `color ${m[0]} isn't a token` });
      }
    });
  }
  return out;
}

export type Report = { failures: Failure[]; coverage: { checked: number; total: number; unchecked: string[] }; passed: boolean };

export async function check(opts: { root?: string; tokens?: string; rules?: Rule[] } = {}): Promise<Report> {
  const root = resolve(opts.root ?? ".");
  const rules = opts.rules ?? loadRules();
  const source = await loadTokenSource(opts.tokens, root);
  const failures: Failure[] = [];
  if (!source) failures.push({ severity: 3, rule: "values.tokens", where: root, message: "no tokens yet", fix: "run gusteau init" });
  else {
    failures.push(...lint(root, source.values, [source.path]));
    if (!opts.tokens) failures.push(...validateTokens(source.values as any, rules));
  }
  failures.push(...componentFailures(loadComponents(root), opts.tokens ? null : (source?.values as any), root));
  failures.sort((a, b) => b.severity - a.severity || a.where.localeCompare(b.where, undefined, { numeric: true }));
  const unchecked = rules.filter((r) => !r.check).map((r) => r.id);
  return { failures, coverage: { checked: rules.length - unchecked.length, total: rules.length, unchecked }, passed: failures.length === 0 };
}
