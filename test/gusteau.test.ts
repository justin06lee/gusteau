import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileBrief } from "../src/core/brief";
import { check, lint } from "../src/core/check";
import { contrast, normalizeHex } from "../src/core/color";
import { addComponent, componentFailures, loadComponents, searchComponents } from "../src/core/components";
import { cssVars, exportTokens, typeNames } from "../src/core/export";
import { initProject, nameFrom } from "../src/core/init";
import { addPref, globalCandidates, parseDecisions, parseReview, promote } from "../src/core/prefs";
import { quickChecks } from "../src/core/primers";
import { lookupRef, saveRef } from "../src/core/refs";
import { loadRules } from "../src/core/rules";
import { FONTS, generateTokens, loadTokens, validateTokens } from "../src/core/tokens";
import { render, scoreTaste, type Metrics } from "../src/core/taste";

const tmp = () => mkdtempSync(join(tmpdir(), "gusteau-"));
const put = (root: string, file: string, text: string) => {
  mkdirSync(join(root, file, ".."), { recursive: true });
  writeFileSync(join(root, file), text);
};

beforeEach(() => { process.env.GUSTEAU_HOME = tmp(); });

describe("color", () => {
  test("hex and contrast", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });
});

describe("init and tokens", () => {
  test("generated tokens pass the global rules", () => {
    for (const req of ["a dark terminal dashboard", "an elegant editorial magazine", "a playful kids game", "a bank app"])
      expect(validateTokens(generateTokens("x", req, loadRules(), tmp()), loadRules())).toEqual([]);
  });

  test("a second project diverges from the first", () => {
    const a = initProject(tmp(), "a warm cozy bakery site", { name: "bakery" }).tokens;
    const b = initProject(tmp(), "a warm cozy bakery site", { name: "bakery" }).tokens;
    expect(b.color.accent).not.toBe(a.color.accent);
    expect([b.font.heading, b.font.body]).not.toContain(a.font.heading);
  });

  test("init refuses to overwrite without force", () => {
    const root = tmp();
    initProject(root, "a todo app");
    expect(() => initProject(root, "a todo app")).toThrow();
    expect(() => initProject(root, "a todo app", { force: true })).not.toThrow();
  });

  test("muted text is readable on the surface too, not only the page", () => {
    for (const req of ["a calm notes app", "a dark terminal dashboard", "a spacious landing page", "a bank app"]) {
      const t = generateTokens("x", req, loadRules(), tmp());
      expect(contrast(t.color.muted, t.color.surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("asking for room widens the space and type scales", () => {
    const roomy = generateTokens("x", "a spacious landing page", loadRules(), tmp());
    expect(roomy.space).toContain(96);
    expect(roomy.space).toContain(128);
    expect(roomy.type.scale).toHaveLength(8);
    expect(validateTokens(roomy, loadRules())).toEqual([]);
    expect(typeNames(roomy.type)).toContain("4xl");
    const plain = generateTokens("x", "a todo app", loadRules(), tmp());
    expect(Math.max(...plain.space)).toBe(64);
    // a global pref asks for room even when the request doesn't
    expect(generateTokens("x", "a todo app", loadRules(), tmp(), "Breathing room").space).toContain(128);
  });

  test("fonts are chosen for a stated reason, and the reason is written down", () => {
    const root = tmp();
    const { tokens, fonts } = initProject(root, "a calm notes app");
    expect(FONTS.find((f) => f.name === tokens.font.heading)?.traits).toContain("calm");
    expect(fonts).toContain('"calm"');
    expect(readFileSync(join(root, ".gusteau", "DESIGN.md"), "utf8")).toContain(fonts);
    const d = parseDecisions(readFileSync(join(root, ".gusteau", "DECISIONS.md"), "utf8"));
    expect(d).toEqual([expect.objectContaining({ id: "d-fonts", status: "proposed" })]);
  });

  test("the project is named from the request before the folder", () => {
    expect(nameFrom("a recipe box called Mise")).toBe("Mise");
    expect(nameFrom('a journal named "Small Hours" for nights')).toBe("Small Hours");
    expect(nameFrom("a notes app called Quiet Notes, for writers")).toBe("Quiet Notes");
    expect(nameFrom("a todo app")).toBeUndefined();
    expect(initProject(tmp(), "a recipe box called Mise").tokens.name).toBe("Mise");
  });
});

describe("brief", () => {
  test("carries this project only, never others or the reference library", () => {
    initProject(tmp(), "a ledger for a coffee roaster", { name: "roastledger" });
    saveRef("Acme Studio", "---\naliases: [acme]\n---\n# Acme Studio\n");
    const root = tmp();
    initProject(root, "a recipe site", { name: "recipes" });
    const brief = compileBrief(root);
    expect(brief).toContain("a recipe site");
    expect(brief).toContain(loadTokens(root)!.font.heading);
    for (const absent of ["roastledger", "coffee", "Acme", "history"]) expect(brief).not.toContain(absent);
  });

  test("includes the primers' quick checks, minus those a rule already says", () => {
    expect(quickChecks()).toContain("Two fonts or fewer?");
    const brief = compileBrief(tmp());
    expect(brief).toContain("Are related things grouped together? (proximity)");
    expect(brief).toContain("Each screen serves one main goal");
    for (const said of ["Two fonts or fewer?", "Is the main goal of the page obvious?", "Strong contrast between text and background?"]) expect(brief).not.toContain(said);
  });
});

describe("check", () => {
  const tokens = { space: [4, 8, 12], radius: { md: 8 }, color: { accent: "#3366ff" } };

  test("lint flags literals that are not tokens", () => {
    const root = tmp();
    put(root, "ui/Card.qml", "Rectangle {\n  radius: 9\n  anchors.margins: 8\n  color: \"#3366ff\"\n}\n");
    put(root, "web/app.css", ".a { color: #abc; padding: 12px; margin: 13px; }\n");
    const found = lint(root, tokens);
    const off = found.filter((f) => f.severity > 0).map((f) => f.where);
    expect(off).toContain("ui/Card.qml:2");
    expect(off).toContain("web/app.css:1");
    expect(off.filter((w) => w.startsWith("ui/Card.qml"))).toEqual(["ui/Card.qml:2"]);
    expect(found.find((f) => f.where === "ui/Card.qml:3")).toMatchObject({ severity: 0, fix: "reference space.1" });
  });

  test("the nearest token comes from the property's own scale", () => {
    const root = tmp();
    put(root, "web/a.css", ".a { border-radius: 11px; padding: 7px; }\n");
    const fixes = lint(root, { space: [4, 8, 12], radius: { sm: 4, lg: 16 }, type: { scale: [10, 13] } }).map((f) => f.fix);
    expect(fixes).toEqual(["nearest token is 16", "nearest token is 8"]);
  });

  test("lint flags color functions, named colors and tailwind palette classes", () => {
    const root = tmp();
    put(root, "web/a.css", ".a { color: tomato; background: rgb(51, 102, 255); border: 1px solid rgb(255 0 170); box-shadow: 0 1px 2px rgba(0,0,0,.1); fill: currentColor; }\n");
    put(root, "web/B.tsx", "export const B = () => <div className=\"bg-pink-500 p-4 bg-[#123456]\" style={{ color: \"gold\", background: t.color.accent }} />;\n");
    const msgs = lint(root, tokens).map((f) => `${f.where} ${f.message}`);
    for (const hit of ["web/a.css:1 color tomato", "web/a.css:1 color rgb(255 0 170)", "web/B.tsx:1 color bg-pink-500", "web/B.tsx:1 color gold", "web/B.tsx:1 color #123456"])
      expect(msgs.some((m) => m.startsWith(hit))).toBe(true);
    expect(msgs.some((m) => /rgb\(51|rgba|currentColor|accent/.test(m))).toBe(false);
  });

  test("comments, pills and marked lines are not failures, and the marks are counted", async () => {
    const root = tmp();
    initProject(root, "a notes app");
    put(root, "web/a.css", ".a { border-radius: 999px; } /* #7a6f63 was 4.28:1 */\n.b { background: url(https://x.io/a.png); } // #123456\n");
    put(root, "web/Logo.tsx", "{/* gusteau-ignore-start: Google's brand colors */}\n<path fill=\"#4285F4\" />\n<path fill=\"#34A853\" />\n{/* gusteau-ignore-end */}\n<path fill=\"#EA4335\" />\n");
    const r = await check({ root });
    expect(r.failures.map((f) => f.where)).toEqual(["web/Logo.tsx:5"]);
    expect(r.scanned).toEqual({ files: 2, ignored: 4 });
  });

  test("a project with no code it can read says so instead of only passing", async () => {
    const root = tmp();
    initProject(root, "a terminal app");
    put(root, "src/main.rs", "fn main() {}\n");
    const r = await check({ root });
    expect(r.passed).toBe(true);
    expect(r.scanned.files).toBe(0);
  });

  test("a clean project passes and reports coverage", async () => {
    const root = tmp();
    initProject(root, "a notes app");
    const r = await check({ root });
    expect(r.passed).toBe(true);
    expect(r.coverage.total).toBe(loadRules().length);
    expect(r.coverage.code).toEqual(["values.tokens", "shape.radius"]);
    expect(r.coverage.page).toContain("ux.goal");
    expect(r.coverage.unchecked).toEqual(["ux.feedback"]);
    const counted = new Set([...r.coverage.code, ...r.coverage.tokens, ...r.coverage.page, ...r.coverage.unchecked]);
    expect(counted.size).toBe(r.coverage.total);
  });
});

describe("export", () => {
  test("css vars cover every token and pass check when written into the project", async () => {
    const root = tmp();
    const { tokens } = initProject(root, "a notes app");
    const vars = new Map(cssVars(tokens));
    expect(vars.get("--color-on-accent")).toBe(tokens.color.onAccent);
    expect(vars.get("--type-body")).toBe(`${tokens.type.body}px`);
    expect(vars.get(`--space-${tokens.space.length}`)).toBe(`${tokens.space.at(-1)}px`);
    put(root, "web/tokens.css", exportTokens(tokens, "css"));
    put(root, "web/tokens.ts", exportTokens(tokens, "ts"));
    expect((await check({ root })).passed).toBe(true);
  });

  test("type steps are named around the body size", () => {
    expect(typeNames({ body: 16, ratio: 1.25, scale: [10, 13, 16, 20, 25, 31, 39], leading: 1.6, leadingTight: 1.2 })).toEqual(["xs", "sm", "body", "md", "lg", "xl", "2xl"]);
  });
});

describe("component library", () => {
  test("search by level and words", () => {
    const root = tmp();
    addComponent({ name: "Primary Button", level: "atom", role: "button", tokens: { radius: "radius.md" } }, root);
    addComponent({ name: "Search Bar", level: "molecule", uses: ["primary-button"] }, root);
    expect(searchComponents("button", root).map((c) => c.slug)).toEqual(["primary-button", "search-bar"]);
    expect(searchComponents("button", root, "atom").map((c) => c.slug)).toEqual(["primary-button"]);
  });

  test("contradictions are failures", () => {
    const root = tmp();
    const t = initProject(root, "a shop").tokens;
    addComponent({ name: "Button", level: "atom", role: "button", tokens: { radius: "radius.md" } }, root);
    addComponent({ name: "Ghost Button", level: "atom", role: "button", tokens: { radius: "radius.lg" } }, root);
    addComponent({ name: "Card", level: "atom", uses: ["header-bar"] }, root);
    addComponent({ name: "Header Bar", level: "organism", tokens: { gap: "space.nope" } }, root);
    const rules = componentFailures(loadComponents(root), t, root).map((f) => f.message).join("\n");
    expect(rules).toMatch(/radius/);
    expect(rules).toMatch(/header-bar/);
    expect(rules).toMatch(/space\.nope/);
  });
});

describe("prefs", () => {
  test("decisions and review replies", () => {
    const d = parseDecisions("# Decisions\n\n## Flat surfaces\nStatus: accepted\nId: d1\n\n**Why:** depth reads as noise\n\n**Instead of:** drop shadows\n");
    expect(d).toEqual([{ id: "d1", title: "Flat surfaces", status: "accepted", why: "depth reads as noise", instead: "drop shadows" }]);
    const r = parseReview({ items: { "type.scale": { verdict: "change", thread: [{ author: "you", text: "bigger headings" }, { author: "claude", text: "ok" }] } } });
    expect(r).toEqual([{ item: "type.scale", verdict: "change", said: ["bigger headings"] }]);
  });

  test("a project pref seen in two projects becomes a candidate, and promotes on confirm", () => {
    const a = tmp(), b = tmp();
    initProject(a, "one"); initProject(b, "two");
    addPref({ says: "Buttons are sentence case", scope: "project", strength: "strong" }, a);
    addPref({ says: "buttons are sentence case.", scope: "project", strength: "lean" }, b);
    expect(globalCandidates().map((c) => c.says)).toEqual(["Buttons are sentence case"]);
    expect(promote("Buttons are sentence case")?.scope).toBe("global");
    expect(globalCandidates()).toEqual([]);
  });
});

describe("refs", () => {
  test("lookup by name or alias, not found otherwise", () => {
    saveRef("Linear", "---\naliases: [linear app, linear.app]\n---\n# Linear\n");
    expect(lookupRef("linear")).toContain("# Linear");
    expect(lookupRef("Linear App")).toContain("# Linear");
    expect(lookupRef("nothing here")).toBeNull();
  });
});

describe("taste", () => {
  const calm: Metrics = {
    url: "x", width: 1280, actions: 2, primary: 1, primaryAboveFold: 1, accentUses: 1, hues: 1, colors: 5,
    caps: 0, bangs: 0, heavy: 0, whitespace: 0.7, maxGap: 64, lowContrast: [], longLines: [], examples: { caps: [], primary: ["Start"] },
  };
  const loud: Metrics = { ...calm, actions: 7, primary: 3, primaryAboveFold: 3, accentUses: 12, caps: 9, bangs: 5, heavy: 4, whitespace: 0.4, maxGap: 16, examples: { caps: ["BUY NOW"], primary: ["BUY", "GET", "TRY"] } };
  const pref = (id: string, says: string) => ({ id, says, scope: "global" as const, strength: "strong" as const });
  const prefs = [pref("p1", "Quiet confidence: no shouting"), pref("p2", "Breathing room between groups"), pref("p3", "Remove before adding")];

  test("findings name the preference that asked for them", () => {
    const fs = scoreTaste(loud, prefs, loadRules(), null);
    const from = (id: string) => fs.filter((f) => f.from.startsWith(id)).length;
    expect([from("p1"), from("p2"), from("p3")]).toEqual([4, 2, 2]);
    expect(fs.find((f) => f.from.startsWith("p1"))!.from).toContain("Quiet confidence");
    expect(fs.some((f) => f.from === "ux.goal")).toBe(false); // primary is already the pref's finding
  });

  test("no prefs: only the rules judge; a calm page passes", () => {
    expect(scoreTaste(calm, prefs, loadRules(), null)).toEqual([]);
    const fs = scoreTaste({ ...loud, hues: 3, lowContrast: [{ text: "fine print", ratio: 3.1, floor: 4.5 }] }, [], loadRules(), null);
    expect(fs.map((f) => f.from).sort()).toEqual(["color.accent", "color.contrast", "ux.goal"]);
    expect(fs[0]!.from).toBe("color.contrast");
  });

  describe("rendered", () => {
    let browser = true;
    beforeAll(async () => { await render("data:text/html,<p>x</p>").catch(() => (browser = false)); });

    test("measures a loud page in a browser", async () => {
      if (!browser) return console.warn("skipped: no chromium for playwright-core");
      const dir = tmp();
      put(dir, "page.html", `<body style="margin:0;background:#fff;color:#111;font:16px sans-serif">
        <h1 style="text-transform:uppercase;font-weight:900">Big sale!!</h1>
        <button style="background:#0057ff;color:#fff;border:0">BUY NOW</button><button style="background:#111;color:#fff;border:0">Try it</button>
        <p style="color:#aaa">fine print</p></body>`);
      const m = await render(join(dir, "page.html"), { accent: "#0057ff" });
      expect([m.actions, m.primary, m.caps, m.bangs, m.heavy, m.accentUses]).toEqual([2, 2, 2, 2, 1, 1]);
      expect(m.lowContrast.map((c) => c.text)).toEqual(["fine print"]);
    }, 30000);
  });
});
