import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeHex } from "./color";
import { loadKind, rulesFor, type Kind } from "./kind";
import { effectivePrefs, type Pref, type Strength } from "./prefs";
import { loadRules, rule, type Rule } from "./rules";
import { loadTokens, type Tokens } from "./tokens";

/** What a rendered page shows, measured in the browser. */
export type Metrics = {
  url: string; width: number;
  actions: number; primary: number; primaryAboveFold: number;
  accentUses: number | null; hues: number; colors: number;
  caps: number; bangs: number; heavy: number;
  whitespace: number; maxGap: number;
  lowContrast: { text: string; ratio: number; floor: number }[];
  longLines: { text: string; chars: number }[];
  examples: { caps: string[]; primary: string[] };
};

/** Runs inside the page. Self-contained: playwright sends its source text. */
function measure({ accent, floor, measureMax }: { accent: string | null; floor: number; measureMax: number }) {
  type C = { r: number; g: number; b: number; a: number };
  const parse = (s: string): C | null => {
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0]!, g: p[1]!, b: p[2]!, a: p.length > 3 ? p[3]! : 1 };
  };
  const key = (c: C) => `${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)}`;
  const lum = (c: C) => [c.r, c.g, c.b].map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i]!, 0);
  const ratio = (a: C, b: C) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x! + 0.05) / (y! + 0.05); };
  const over = (top: C, under: C): C => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const bgOf = (el: Element | null): C => {
    const layers: C[] = [];
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    return layers.reverse().reduce((under, c) => over(c, under), { r: 255, g: 255, b: 255, a: 1 });
  };
  const hue = (c: C) => {
    const [r, g, b] = [c.r / 255, c.g / 255, c.b / 255];
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    if (s < 0.3 || l < 0.12 || l > 0.92) return null;
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return Math.round(((h * 60 + 360) % 360) / 30) % 12;
  };
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && +s.opacity > 0;
  };
  const ownText = (el: Element) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ").replace(/\s+/g, " ").trim();
  const accentC = accent ? parse(`rgb(${parseInt(accent.slice(1, 3), 16)},${parseInt(accent.slice(3, 5), 16)},${parseInt(accent.slice(5, 7), 16)})`) : null;
  const isAccent = (c: C | null) => !!(c && accentC && c.a > 0.5 && key(c) === key(accentC));

  const cell = 8, W = document.documentElement.clientWidth, H = Math.max(document.documentElement.scrollHeight, innerHeight);
  const cols = Math.ceil(W / cell), rows = Math.ceil(H / cell), ink = new Uint8Array(cols * rows);
  const mark = (r: DOMRect) => {
    const [x0, y0] = [Math.max(0, Math.floor((r.left + scrollX) / cell)), Math.max(0, Math.floor((r.top + scrollY) / cell))];
    const [x1, y1] = [Math.min(cols, Math.ceil((r.right + scrollX) / cell)), Math.min(rows, Math.ceil((r.bottom + scrollY) / cell))];
    for (let y = y0; y < y1; y++) ink.fill(1, y * cols + x0, y * cols + x1);
  };

  const out = { actions: 0, primary: 0, primaryAboveFold: 0, accentUses: accentC ? 0 : null as number | null, caps: 0, bangs: 0, heavy: 0, lowContrast: [] as { text: string; ratio: number; floor: number }[], longLines: [] as { text: string; chars: number }[], examples: { caps: [] as string[], primary: [] as string[] } };
  const colors = new Set<string>(), hues = new Set<number>();
  const addColor = (c: C | null) => { if (!c || c.a < 0.5) return; colors.add(key(c)); const h = hue(c); if (h !== null) hues.add(h); };

  for (const el of [...document.body.querySelectorAll("*")].filter(visible)) {
    const s = getComputedStyle(el), text = ownText(el);
    const bg = parse(s.backgroundColor), fg = parse(s.color);
    const border = parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== "none" ? parse(s.borderTopColor) : null;
    addColor(bg); addColor(border); if (text) addColor(fg);
    for (const m of s.backgroundImage.matchAll(/rgba?\([^)]+\)/g)) addColor(parse(m[0]));
    if (out.accentUses !== null && (isAccent(bg) || isAccent(border) || (text && isAccent(fg)))) out.accentUses++;

    const buttonish = el.matches("button, [role=button], input[type=submit], input[type=button]") || (el.matches("a") && ((bg?.a ?? 0) > 0 || !!border));
    if (buttonish) {
      out.actions++;
      mark(el.getBoundingClientRect());
      const under = bgOf(el.parentElement);
      if (bg && bg.a > 0.5 && (isAccent(bg) || ratio(over(bg, under), under) >= 3)) {
        out.primary++;
        if (el.getBoundingClientRect().top + scrollY < innerHeight) out.primaryAboveFold++;
        out.examples.primary.push(((el as HTMLElement).innerText || el.getAttribute("value") || "").trim().slice(0, 30));
      }
    }
    if (el.matches("img, svg, video, canvas, input, select, textarea")) mark(el.getBoundingClientRect());
    // a filled box you can see as a block (a badge, a banner) is ink; a faint surface tint is not
    else if (bg && bg.a > 0.5 && !buttonish) { const u = bgOf(el.parentElement); if (ratio(over(bg, u), u) >= 1.5) mark(el.getBoundingClientRect()); }
    if (!text) continue;

    const letters = text.replace(/[^A-Za-z]/g, "");
    if ((s.textTransform === "uppercase" && letters.length >= 2) || (letters.length >= 4 && letters === letters.toUpperCase())) {
      out.caps++;
      out.examples.caps.push(text.slice(0, 30));
    }
    if (parseInt(s.fontWeight) >= 800) out.heavy++;
    if (fg) {
      const size = parseFloat(s.fontSize), bold = parseInt(s.fontWeight) >= 700;
      const min = size >= 24 || (size >= 18.66 && bold) ? Math.min(3, floor) : floor;
      const under = bgOf(el), r = ratio(over(fg, under), under);
      if (r < min) out.lowContrast.push({ text: text.slice(0, 40), ratio: Math.round(r * 100) / 100, floor: min });
    }
  }

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent ?? "";
    if (!t.trim() || !n.parentElement || !visible(n.parentElement) || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(n.parentElement.tagName)) continue;
    out.bangs += (t.match(/!/g) ?? []).length;
    range.selectNodeContents(n);
    const lines = [...range.getClientRects()].filter((r) => r.width > 0);
    lines.forEach(mark);
    const chars = t.replace(/\s+/g, " ").trim().length;
    if (lines.length >= 3 && chars / lines.length > measureMax) out.longLines.push({ text: t.trim().slice(0, 40), chars: Math.round(chars / lines.length) });
  }

  // whitespace and the largest empty band, inside the box the content occupies
  let [minR, maxR, minC, maxC, filled] = [rows, -1, cols, -1, 0];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (ink[y * cols + x]) { filled++; minR = Math.min(minR, y); maxR = Math.max(maxR, y); minC = Math.min(minC, x); maxC = Math.max(maxC, x); }
  let [gap, run] = [0, 0];
  for (let y = minR; y <= maxR; y++) {
    const empty = !ink.subarray(y * cols, (y + 1) * cols).some(Boolean);
    run = empty ? run + 1 : 0;
    gap = Math.max(gap, run);
  }
  const box = maxR < 0 ? 1 : (maxR - minR + 1) * (maxC - minC + 1);
  return { ...out, hues: hues.size, colors: colors.size, whitespace: Math.round((1 - filled / box) * 100) / 100, maxGap: gap * cell };
}

/** Render a page (file or URL) headless and measure it. */
export async function render(target: string, opts: { width?: number; height?: number; accent?: string; floor?: number; measureMax?: number } = {}): Promise<Metrics> {
  const { width = 1280, height = 800 } = opts;
  let pw: typeof import("playwright-core");
  try { pw = await import("playwright-core"); } catch { throw new Error("taste renders the page with playwright-core: bun add playwright-core"); }
  const isUrl = /^(https?|file|data):/.test(target);
  if (!isUrl && !existsSync(target)) throw new Error(`no such page: ${target}`);
  const url = isUrl ? target : pathToFileURL(resolve(target)).href;
  const browser = await pw.chromium.launch().catch(() => pw.chromium.launch({ channel: "chrome" })).catch(() => {
    throw new Error("taste needs a browser: run `bunx playwright install chromium`, or install Google Chrome");
  });
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    // a page still loading after 15s is measured as it stands; one that can't load is an error
    await page.goto(url, { waitUntil: "load", timeout: 15000 }).catch((e: Error) => { if (e.name !== "TimeoutError") throw new Error(`could not load ${url}: ${e.message.split("\n")[0]}`); });
    await page.evaluate(() => document.fonts.ready.then(() => {}));
    const accent = opts.accent ? normalizeHex(opts.accent) : null;
    const m = await page.evaluate(measure, { accent, floor: opts.floor ?? 4.5, measureMax: opts.measureMax ?? 75 });
    return { url, width, ...m };
  } finally {
    await browser.close();
  }
}

export type Finding = { severity: number; from: string; message: string };
/** `atmosphere` limits are the ones a marketing page trades away: color and depth, not caps or shouting. */
type Limit = { metric: string; atmosphere?: boolean; ok: (m: Metrics) => boolean; says: (m: Metrics) => string };

const list = (xs: string[]) => xs.slice(0, 3).map((x) => `"${x}"`).join(", ") + (xs.length > 3 ? ", …" : "");

/** The limits a preference asks for, found by its words. */
const ASKS: { words: RegExp; limits: (t: Tokens | null) => Limit[] }[] = [
  {
    words: /\b(quiet|loud|calm|confiden|restrain|understat|subtle|shout|sentence case)/i,
    limits: () => [
      { metric: "caps", ok: (m) => m.caps === 0, says: (m) => `${m.caps} elements in all caps: ${list(m.examples.caps)}` },
      { metric: "bangs", ok: (m) => m.bangs === 0, says: (m) => `${m.bangs} exclamation marks` },
      { metric: "heavy", ok: (m) => m.heavy === 0, says: (m) => `${m.heavy} text elements at weight 800 or more` },
      { metric: "accentUses", atmosphere: true, ok: (m) => m.accentUses === null || m.accentUses <= 3, says: (m) => `the accent is on ${m.accentUses} elements; 3 at most keeps it for what matters` },
    ],
  },
  {
    words: /\b(breath|room|spacious|airy|generous|cramp|whitespace|white space)/i,
    limits: (t) => {
      const gap = 3 * (t?.type.body ?? 16);
      return [
        { metric: "whitespace", ok: (m) => m.whitespace >= 0.6, says: (m) => `${Math.round(m.whitespace * 100)}% of the content area is empty; 60% or more gives room` },
        { metric: "maxGap", ok: (m) => m.maxGap >= gap, says: (m) => `the widest space between groups is ${m.maxGap}px; at least one section break of ${gap}px (3× the body size)` },
      ];
    },
  },
  {
    words: /\b(remove|fewer|one main action|extra button|only what|declutter|clutter)/i,
    limits: () => [
      { metric: "primary", ok: (m) => m.primary <= 1, says: (m) => `${m.primary} filled actions: ${list(m.examples.primary)}; one main action` },
      { metric: "actions", ok: (m) => m.actions <= 4, says: (m) => `${m.actions} buttons in all; 4 at most` },
    ],
  },
];

const RANK: Record<Strength, number> = { hard: 3, strong: 2, lean: 1 };

/** Findings for a measured page: from the user's preferences (by their words) and from the rules. A marketing page may use more color for atmosphere. */
export function scoreTaste(m: Metrics, prefs: Pref[], rules: Rule[], tokens: Tokens | null, kind: Kind = "product"): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const p of prefs)
    for (const ask of ASKS.filter((a) => a.words.test(p.says)))
      for (const l of ask.limits(tokens).filter((l) => !(l.atmosphere && kind === "marketing")))
        if (!seen.has(l.metric) && !l.ok(m)) { seen.add(l.metric); out.push({ severity: RANK[p.strength], from: `${p.id} "${p.says.split(/[:.]/)[0]}"`, message: l.says(m) }); }
  if (rule(rules, "ux.goal") && m.primaryAboveFold > 1 && !seen.has("primary"))
    out.push({ severity: 2, from: "ux.goal", message: `${m.primaryAboveFold} filled actions in the first screen: ${list(m.examples.primary)}` });
  if (rule(rules, "color.accent") && kind !== "marketing") {
    const max = rule(rules, "color.accent")!.max ?? 1;
    if (m.hues > max) out.push({ severity: 2, from: "color.accent", message: `${m.hues} saturated hues on the page; ${max} accent` });
  }
  const floor = rule(rules, "color.contrast");
  if (floor && m.lowContrast.length)
    out.push({ severity: 3, from: "color.contrast", message: `${m.lowContrast.length} text elements under contrast: ${m.lowContrast.slice(0, 3).map((c) => `"${c.text}" ${c.ratio}:1`).join(", ")}` });
  if (rule(rules, "type.measure") && m.longLines.length)
    out.push({ severity: 1, from: "type.measure", message: `${m.longLines.length} paragraphs run past ${rule(rules, "type.measure")!.max} characters a line: ${m.longLines.slice(0, 2).map((l) => `"${l.text}" ${l.chars}`).join(", ")}` });
  return out.sort((a, b) => b.severity - a.severity);
}

export const TASTE_RULES = ["ux.goal", "color.accent", "color.contrast", "type.measure"];

export type TasteReport = { metrics: Metrics; findings: Finding[]; passed: boolean };

export async function taste(target: string, opts: { root?: string; width?: number } = {}): Promise<TasteReport> {
  const tokens = loadTokens(opts.root);
  const kind = loadKind(opts.root);
  const rules = rulesFor(loadRules(), kind);
  const { global, project } = effectivePrefs(opts.root, kind);
  const metrics = await render(target, { width: opts.width, accent: tokens?.color.accent, floor: rule(rules, "color.contrast")?.min, measureMax: rule(rules, "type.measure")?.max });
  const findings = scoreTaste(metrics, [...project, ...global], rules, tokens, kind);
  return { metrics, findings, passed: findings.length === 0 };
}

const n = (k: number | null, one: string, many = one + "s") => `${k ?? "?"} ${k === 1 ? one : many}`;

export function formatTaste(r: TasteReport): string {
  const m = r.metrics;
  const lines = r.findings.map((f) => `[${f.severity}] ${f.message}  (${f.from})`);
  lines.push(`measured: ${n(m.actions, "button")} (${m.primary} filled, ${m.primaryAboveFold} in the first screen), accent on ${n(m.accentUses, "element")}, ${n(m.hues, "saturated hue")}, ${n(m.colors, "color")}, ${m.caps} all caps, ${m.bangs} "!", ${Math.round(m.whitespace * 100)}% empty, widest gap ${m.maxGap}px`);
  lines.push(r.passed ? "passed" : `${r.findings.length} failing`);
  return lines.join("\n");
}
