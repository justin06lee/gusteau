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

type Mood = { hues: [number, number]; dark: boolean; shape: "sharp" | "neutral" | "round"; serif: boolean; dense: boolean; roomy: boolean };

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
    roomy: has(request, ["breath", "room", "airy", "generous", "spacious", "whitespace", "white space", "landing", "editorial", "portfolio"]),
  };
}

type Font = { name: string; kind: "sans" | "serif" | "mono"; traits: string[] };

/** The fonts init chooses from, each with what it suits. */
export const FONTS: Font[] = [
  { name: "Inter", kind: "sans", traits: ["neutral", "interface", "technical"] },
  { name: "Public Sans", kind: "sans", traits: ["neutral", "trust", "plain"] },
  { name: "Onest", kind: "sans", traits: ["neutral", "calm", "plain"] },
  { name: "IBM Plex Sans", kind: "sans", traits: ["technical", "serious", "trust"] },
  { name: "Geist", kind: "sans", traits: ["technical", "minimal", "modern"] },
  { name: "Manrope", kind: "sans", traits: ["geometric", "modern", "friendly"] },
  { name: "DM Sans", kind: "sans", traits: ["geometric", "friendly", "soft"] },
  { name: "Figtree", kind: "sans", traits: ["friendly", "warm", "playful"] },
  { name: "Work Sans", kind: "sans", traits: ["humanist", "warm", "editorial"] },
  { name: "Instrument Sans", kind: "sans", traits: ["calm", "refined", "editorial"] },
  { name: "Hanken Grotesk", kind: "sans", traits: ["calm", "humanist", "quiet"] },
  { name: "Schibsted Grotesk", kind: "sans", traits: ["editorial", "confident", "news"] },
  { name: "Newsreader", kind: "serif", traits: ["editorial", "news", "reading"] },
  { name: "Source Serif 4", kind: "serif", traits: ["reading", "calm", "serious"] },
  { name: "Literata", kind: "serif", traits: ["reading", "book", "calm"] },
  { name: "Lora", kind: "serif", traits: ["warm", "literary", "friendly"] },
  { name: "Spectral", kind: "serif", traits: ["elegant", "literary", "quiet"] },
  { name: "Instrument Serif", kind: "serif", traits: ["elegant", "refined", "editorial"] },
  { name: "Fraunces", kind: "serif", traits: ["warm", "playful", "soft"] },
  { name: "Young Serif", kind: "serif", traits: ["warm", "playful", "confident"] },
  { name: "JetBrains Mono", kind: "mono", traits: ["technical", "interface"] },
  { name: "IBM Plex Mono", kind: "mono", traits: ["technical", "serious", "trust"] },
  { name: "Geist Mono", kind: "mono", traits: ["minimal", "modern"] },
  { name: "Fira Code", kind: "mono", traits: ["technical"] },
  { name: "Commit Mono", kind: "mono", traits: ["neutral", "calm", "quiet"] },
  { name: "Martian Mono", kind: "mono", traits: ["geometric", "playful"] },
];

/** The words in a request or a preference that call for each trait. */
const TRAIT_WORDS: Record<string, string[]> = {
  technical: ["technical", "develop", "code", "terminal", "dashboard", "data", "api", "engineer", "admin", "ide", "devtool"],
  interface: ["tool", "settings", "form", "interface"], // not "app": nearly every request says it
  calm: ["calm", "focus", "notes", "meditat", "journal", "wellness", "restrain", "confiden", "breath"],
  quiet: ["quiet", "subtle", "understat", "minimal", "restrain", "confiden"],
  minimal: ["minimal", "simple", "clean"],
  plain: ["plain", "simple", "government", "civic", "form"],
  trust: ["bank", "financ", "trust", "health", "medical", "insur", "legal", "civic", "government"],
  serious: ["serious", "precise", "professional", "enterprise", "research"],
  editorial: ["editorial", "magazine", "blog", "article", "story", "essay", "publication"],
  news: ["news", "press", "report"],
  reading: ["read", "book", "longform", "long-form", "docs", "documentation", "article", "essay", "writing"],
  book: ["book", "library", "novel"],
  literary: ["literary", "poetry", "poem", "writer", "author"],
  elegant: ["elegant", "luxury", "fashion", "premium", "boutique", "wedding", "jewel"],
  refined: ["refined", "elegant", "premium", "portfolio", "studio", "gallery"],
  warm: ["warm", "cozy", "food", "bakery", "coffee", "recipe", "cook", "restaurant", "kitchen", "cafe"],
  friendly: ["friendly", "family", "community", "social", "kid", "approachable"],
  playful: ["playful", "fun", "game", "kid", "toy"],
  soft: ["soft", "gentle", "baby", "pet"],
  humanist: ["human", "personal", "wellness", "care", "therapy"],
  geometric: ["geometric", "startup", "saas", "launch"],
  modern: ["modern", "startup", "saas", "ai", "fintech"],
  confident: ["confident", "bold", "brand", "agency"],
  neutral: [],
};

/** The traits a text calls for, and the words that called them. */
export function traitsIn(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [trait, words] of Object.entries(TRAIT_WORDS)) {
    const hit = words.filter((w) => new RegExp(`\\b${w}`, "i").test(text));
    if (hit.length) out.set(trait, hit);
  }
  return out;
}

/** The fonts of a kind that suit the text best; neutral fonts win when nothing is asked for. */
function bestFonts(kind: Font["kind"], wanted: Map<string, string[]>, used: Set<string>, not: string[] = []) {
  const pool = FONTS.filter((f) => f.kind === kind && !not.includes(f.name));
  const fresh = pool.filter((f) => !used.has(f.name)).length ? pool.filter((f) => !used.has(f.name)) : pool;
  const score = (f: Font) => f.traits.filter((t) => wanted.has(t)).length;
  const top = Math.max(...fresh.map(score));
  const best = fresh.filter((f) => score(f) === top);
  return (top === 0 && best.some((f) => f.traits.includes("neutral")) ? best.filter((f) => f.traits.includes("neutral")) : best).map((f) => f.name);
}

/** Why these fonts: the traits they share with the request and the user's preferences. */
export function fontReason(font: Tokens["font"], text: string): string {
  const wanted = traitsIn(text);
  const why = (name: string) => {
    const shared = FONTS.find((f) => f.name === name)?.traits.filter((t) => wanted.has(t)) ?? [];
    return shared.length ? `${name} is ${shared.join(", ")} (${[...new Set(shared.flatMap((t) => wanted.get(t)!))].map((w) => `"${w}"`).join(", ")})` : `${name}, since nothing asked for a character`;
  };
  return [`headings: ${why(font.heading)}`, ...(font.body !== font.heading ? [`body: ${why(font.body)}`] : []), `code: ${why(font.mono)}`].join("; ");
}

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

/** Readable text color for its backgrounds, shifted until it clears the contrast floor on each. */
function readable(h: number, s: number, l: number, bgs: string[], floor: number, darker: boolean) {
  let hex = hslToHex(h, s, l);
  while (bgs.some((bg) => contrast(hex, bg) < floor) && l > 0 && l < 100) hex = hslToHex(h, s, (l += darker ? -2 : 2));
  return hex;
}

/** `taste` is the text of the user's global preferences; it counts with the request toward fonts and room. */
export function generateTokens(name: string, request: string, rules: Rule[], root: string, taste = ""): Tokens {
  const mood = readMood(request);
  const wanted = traitsIn(request + "\n" + taste);
  if (!mood.roomy) mood.roomy = readMood(taste).roomy;
  const r = rng(name + "\n" + request);
  const recent = loadHistory().filter((h) => h.root !== root).slice(-8);
  const usedFonts = new Set(recent.flatMap((h) => h.fonts));

  const [lo, hi] = mood.hues;
  const hues = [];
  for (let h = lo; h <= hi; h += 5) if (recent.every((p) => hueGap(p.accentHue, h) >= 25)) hues.push(h);
  const hue = hues.length ? pick(hues, r) : lo + Math.floor(r() * (hi - lo));

  const floor = rule(rules, "color.contrast")?.min ?? 4.5;
  const bg = mood.dark ? hslToHex(hue, 12, 9) : hslToHex(hue, 20, 98);
  const accentL = mood.dark ? 62 : 44;
  const white = "#ffffff", ink = hslToHex(hue, 20, 10);
  // away from the page also means more contrast for the text on the accent; some hues need a few steps for that
  let accent = readable(hue, 68, accentL, [bg], 3, !mood.dark);
  for (let l = accentL; Math.max(contrast(white, accent), contrast(ink, accent)) < floor && l > 0 && l < 100; )
    accent = readable(hue, 68, (l += mood.dark ? 2 : -2), [bg], 3, !mood.dark);
  const surface = mood.dark ? hslToHex(hue, 12, 13) : hslToHex(hue, 16, 95);
  const color = {
    bg,
    surface,
    text: readable(hue, 15, mood.dark ? 92 : 12, [bg, surface], 7, !mood.dark),
    muted: readable(hue, 8, mood.dark ? 66 : 42, [bg, surface], floor, !mood.dark),
    border: mood.dark ? hslToHex(hue, 10, 22) : hslToHex(hue, 12, 87),
    accent,
    onAccent: contrast(white, accent) >= contrast(ink, accent) ? white : ink,
  };

  // serif headings when the request reads as editorial; serif body too when it is for reading at length
  const heading = pick(bestFonts(mood.serif ? "serif" : "sans", wanted, usedFonts), r)!;
  const body = pick(bestFonts(mood.serif && wanted.has("reading") ? "serif" : "sans", wanted, usedFonts, [heading]), r)!;
  const step = rule(rules, "spacing.grid")?.step ?? 4;
  const base = mood.dense ? step : step * 2;
  const bodySize = Math.max(rule(rules, "type.body")?.min ?? 16, 16);
  const ratio = mood.dense ? 1.2 : mood.serif ? 1.333 : 1.25;
  const radius = { sharp: { sm: 2, md: 4, lg: 6 }, neutral: { sm: 4, md: 8, lg: 12 }, round: { sm: 8, md: 12, lg: 20 } }[mood.shape];

  return {
    name,
    color,
    font: { heading, body, mono: pick(bestFonts("mono", wanted, usedFonts), r)! },
    // room asked for: two more display sizes and two wider section gaps
    type: { body: bodySize, ratio, scale: [-1, 0, 1, 2, 3, 4, ...(mood.roomy ? [5, 6] : [])].map((n) => Math.round(bodySize * ratio ** n)), leading: mood.dense ? 1.45 : 1.6, leadingTight: 1.2 },
    space: [1, 2, 3, 4, 6, 8, 12, 16, ...(mood.roomy ? [24, 32] : [])].map((n) => (n * base) / 2).filter((v) => v % step === 0),
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
  for (const [fg, bg] of [["text", "bg"], ["text", "surface"], ["muted", "bg"], ["muted", "surface"], ["onAccent", "accent"]] as const) {
    const c = contrast(t.color[fg], t.color[bg]);
    if (c < floor) f(3, "color.contrast", `color.${fg} on color.${bg} is ${c.toFixed(2)}:1, under ${floor}:1`);
  }
  // a rule left out (a terminal app has no tap targets) isn't checked
  const families = new Set([t.font.heading, t.font.body]).size;
  if (r("type.families") && families > (r("type.families")!.max ?? 2)) f(2, "type.families", `${families} font families`);
  if (r("type.body") && t.type.body < (r("type.body")!.min ?? 16)) f(2, "type.body", `body text is ${t.type.body}px`);
  const lead = r("type.leading");
  if (lead && (t.type.leading < lead.min! || t.type.leading > lead.max!)) f(1, "type.leading", `body line height is ${t.type.leading}`);
  const step = r("spacing.grid")?.step;
  for (const s of t.space) if (step && s % step) f(1, "spacing.grid", `space ${s} is off the ${step}px grid`);
  const mo = r("motion.duration");
  for (const [k, v] of Object.entries(t.motion)) if (mo && typeof v === "number" && (v < mo.min! || v > mo.max!)) f(1, "motion.duration", `motion.${k} is ${v}ms`);
  if (r("touch.target") && t.target < (r("touch.target")!.min ?? 44)) f(2, "touch.target", `tap target is ${t.target}px`);
  return out;
}

export const tokensPath = (root?: string) => join(projectDir(root), "tokens.json");
export const loadTokens = (root?: string) => readJson<Tokens | null>(tokensPath(root), null);
