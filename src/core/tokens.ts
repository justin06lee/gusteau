import { join } from "node:path";
import { contrast, hslToHex, hueGap } from "./color";
import { type Rule, rule } from "./rules";
import { globalHome, projectDir, readJson, readYaml, writeYaml } from "./store";

export type Tokens = {
  name: string;
  color: { bg: string; surface: string; text: string; muted: string; border: string; accent: string; onAccent: string };
  font: { heading: string; body: string; mono: string };
  type: { body: number; ratio: number; scale: number[]; leading: number; leadingTight: number };
  space: number[];
  radius: { sm: number; md: number; lg: number };
  motion: { fast: number; base: number; slow: number; easing: string };
  target: number;
};

type Mood = { hues: [number, number]; dark: boolean; shape: "sharp" | "neutral" | "round"; serif: boolean; dense: boolean };

const has = (text: string, words: string[]) => words.some((w) => new RegExp(`\\b${w}`, "i").test(text));

/** Read a mood from the user's own words. Unknown words leave the neutral defaults. */
export function readMood(request: string): Mood {
  const hues: [number, number] =
    has(request, ["warm", "cozy", "food", "playful", "fun", "energ", "bakery", "coffee"]) ? [8, 48]
    : has(request, ["nature", "eco", "green", "garden", "health", "plant"]) ? [90, 165]
    : has(request, ["calm", "trust", "financ", "bank", "focus", "professional", "medical"]) ? [185, 250]
    : [0, 359];
  return {
    hues,
    dark: has(request, ["dark", "night", "terminal", "moody", "cinema", "hacker"]),
    shape: has(request, ["friendly", "playful", "soft", "round", "kid", "bubbl"]) ? "round"
      : has(request, ["serious", "precise", "editorial", "brutal", "technical", "minimal", "swiss"]) ? "sharp" : "neutral",
    serif: has(request, ["editorial", "magazine", "blog", "literary", "elegant", "luxury", "book", "journal"]),
    dense: has(request, ["dense", "dashboard", "data", "admin", "tool", "spreadsheet", "ide"]),
  };
}

const SANS = ["Inter", "Manrope", "IBM Plex Sans", "Geist", "DM Sans", "Public Sans", "Figtree", "Work Sans", "Instrument Sans", "Onest", "Schibsted Grotesk", "Hanken Grotesk"];
const SERIF = ["Fraunces", "Newsreader", "Source Serif 4", "Literata", "Instrument Serif", "Lora", "Spectral", "Young Serif"];
const MONO = ["JetBrains Mono", "IBM Plex Mono", "Geist Mono", "Fira Code", "Commit Mono", "Martian Mono"];

/** Small seeded PRNG so the same project and request give the same sheet. */
function rng(seed: string) {
  let s = Number(Bun.hash(seed) % 2147483647n) || 1;
  return () => (s = (s * 48271) % 2147483647) / 2147483647;
}
const pick = <T>(xs: T[], r: () => number) => xs[Math.floor(r() * xs.length)];

export type HistoryEntry = { project: string; root: string; fonts: string[]; accentHue: number; at: string };
const historyPath = () => join(globalHome(), "history.yaml");
export const loadHistory = () => readYaml<HistoryEntry[]>(historyPath(), []);

export function remember(entry: HistoryEntry) {
  const rest = loadHistory().filter((h) => h.root !== entry.root);
  writeYaml(historyPath(), [...rest, entry].slice(-50));
}

/** Readable text color for a background, shifted until it clears the contrast floor. */
function readable(h: number, s: number, l: number, bg: string, floor: number, darker: boolean) {
  let hex = hslToHex(h, s, l);
  while (contrast(hex, bg) < floor && l > 0 && l < 100) hex = hslToHex(h, s, (l += darker ? -2 : 2));
  return hex;
}

export function generateTokens(name: string, request: string, rules: Rule[], root: string): Tokens {
  const mood = readMood(request);
  const r = rng(name + "\n" + request);
  const recent = loadHistory().filter((h) => h.root !== root).slice(-8);
  const usedFonts = new Set(recent.flatMap((h) => h.fonts));
  const fresh = (xs: string[]) => (xs.filter((x) => !usedFonts.has(x)).length ? xs.filter((x) => !usedFonts.has(x)) : xs);

  const [lo, hi] = mood.hues;
  const hues = [];
  for (let h = lo; h <= hi; h += 5) if (recent.every((p) => hueGap(p.accentHue, h) >= 25)) hues.push(h);
  const hue = hues.length ? pick(hues, r) : lo + Math.floor(r() * (hi - lo));

  const floor = rule(rules, "color.contrast")?.min ?? 4.5;
  const bg = mood.dark ? hslToHex(hue, 12, 9) : hslToHex(hue, 20, 98);
  const accentL = mood.dark ? 62 : 44;
  const accent = readable(hue, 68, accentL, bg, 3, !mood.dark);
  const white = "#ffffff", ink = hslToHex(hue, 20, 10);
  const color = {
    bg,
    surface: mood.dark ? hslToHex(hue, 12, 13) : hslToHex(hue, 16, 95),
    text: readable(hue, 15, mood.dark ? 92 : 12, bg, 7, !mood.dark),
    muted: readable(hue, 8, mood.dark ? 66 : 42, bg, floor, !mood.dark),
    border: mood.dark ? hslToHex(hue, 10, 22) : hslToHex(hue, 12, 87),
    accent,
    onAccent: contrast(white, accent) >= contrast(ink, accent) ? white : ink,
  };

  const heading = mood.serif ? pick(fresh(SERIF), r) : pick(fresh(SANS), r);
  const body = mood.serif && r() < 0.5 ? pick(fresh(SERIF), r) : pick(fresh(SANS).filter((f) => f !== heading), r);
  const step = rule(rules, "spacing.grid")?.step ?? 4;
  const base = mood.dense ? step : step * 2;
  const bodySize = Math.max(rule(rules, "type.body")?.min ?? 16, 16);
  const ratio = mood.dense ? 1.2 : mood.serif ? 1.333 : 1.25;
  const radius = { sharp: { sm: 2, md: 4, lg: 6 }, neutral: { sm: 4, md: 8, lg: 12 }, round: { sm: 8, md: 12, lg: 20 } }[mood.shape];

  return {
    name,
    color,
    font: { heading, body, mono: pick(fresh(MONO), r) },
    type: { body: bodySize, ratio, scale: [-1, 0, 1, 2, 3, 4].map((n) => Math.round(bodySize * ratio ** n)), leading: mood.dense ? 1.45 : 1.6, leadingTight: 1.2 },
    space: [1, 2, 3, 4, 6, 8, 12, 16].map((n) => (n * base) / 2).filter((v) => v % step === 0),
    radius,
    motion: { fast: 120, base: 200, slow: 300, easing: "cubic-bezier(0.2, 0, 0, 1)" },
    target: Math.max(rule(rules, "touch.target")?.min ?? 44, 44),
  };
}

export type Failure = { severity: number; rule: string; where: string; message: string; fix?: string };

/** Check the project's chosen values against the global rules. */
export function validateTokens(t: Tokens, rules: Rule[], where = ".gusteau/tokens.json"): Failure[] {
  const out: Failure[] = [];
  const f = (severity: number, id: string, message: string) => out.push({ severity, rule: id, where, message });
  const r = (id: string) => rule(rules, id);
  const floor = r("color.contrast")?.min ?? 4.5;
  for (const [fg, bg] of [["text", "bg"], ["text", "surface"], ["muted", "bg"], ["onAccent", "accent"]] as const) {
    const c = contrast(t.color[fg], t.color[bg]);
    if (c < floor) f(3, "color.contrast", `color.${fg} on color.${bg} is ${c.toFixed(2)}:1, under ${floor}:1`);
  }
  const families = new Set([t.font.heading, t.font.body]).size;
  if (families > (r("type.families")?.max ?? 2)) f(2, "type.families", `${families} font families`);
  if (t.type.body < (r("type.body")?.min ?? 16)) f(2, "type.body", `body text is ${t.type.body}px`);
  const lead = r("type.leading");
  if (lead && (t.type.leading < lead.min! || t.type.leading > lead.max!)) f(1, "type.leading", `body line height is ${t.type.leading}`);
  const step = r("spacing.grid")?.step;
  for (const s of t.space) if (step && s % step) f(1, "spacing.grid", `space ${s} is off the ${step}px grid`);
  const mo = r("motion.duration");
  for (const [k, v] of Object.entries(t.motion)) if (mo && typeof v === "number" && (v < mo.min! || v > mo.max!)) f(1, "motion.duration", `motion.${k} is ${v}ms`);
  if (t.target < (r("touch.target")?.min ?? 44)) f(2, "touch.target", `tap target is ${t.target}px`);
  return out;
}

export const tokensPath = (root?: string) => join(projectDir(root), "tokens.json");
export const loadTokens = (root?: string) => readJson<Tokens | null>(tokensPath(root), null);
