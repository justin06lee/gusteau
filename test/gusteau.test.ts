import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileBrief } from "../src/core/brief";
import { check, lint } from "../src/core/check";
import { contrast, normalizeHex } from "../src/core/color";
import { addComponent, componentFailures, loadComponents, searchComponents } from "../src/core/components";
import { initProject } from "../src/core/init";
import { addPref, globalCandidates, parseDecisions, parseReview, promote } from "../src/core/prefs";
import { quickChecks } from "../src/core/primers";
import { lookupRef, saveRef } from "../src/core/refs";
import { loadRules } from "../src/core/rules";
import { generateTokens, loadTokens, validateTokens } from "../src/core/tokens";

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

  test("lint flags color functions, named colors and tailwind palette classes", () => {
    const root = tmp();
    put(root, "web/a.css", ".a { color: tomato; background: rgb(51, 102, 255); border: 1px solid rgb(255 0 170); box-shadow: 0 1px 2px rgba(0,0,0,.1); fill: currentColor; }\n");
    put(root, "web/B.tsx", "export const B = () => <div className=\"bg-pink-500 p-4 bg-[#123456]\" style={{ color: \"gold\", background: t.color.accent }} />;\n");
    const msgs = lint(root, tokens).map((f) => `${f.where} ${f.message}`);
    for (const hit of ["web/a.css:1 color tomato", "web/a.css:1 color rgb(255 0 170)", "web/B.tsx:1 color bg-pink-500", "web/B.tsx:1 color gold", "web/B.tsx:1 color #123456"])
      expect(msgs.some((m) => m.startsWith(hit))).toBe(true);
    expect(msgs.some((m) => /rgb\(51|rgba|currentColor|accent/.test(m))).toBe(false);
  });

  test("a clean project passes and reports coverage", async () => {
    const root = tmp();
    initProject(root, "a notes app");
    const r = await check({ root });
    expect(r.passed).toBe(true);
    expect(r.coverage.checked).toBeGreaterThan(0);
    expect(r.coverage.total).toBe(loadRules().length);
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
