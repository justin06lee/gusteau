#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";
import { compileBrief } from "./core/brief";
import { check, type Report } from "./core/check";
import { addComponent, LEVELS, loadComponents, searchComponents, type Level } from "./core/components";
import { initProject } from "./core/init";
import { KINDS, loadKind, saveKind, type Kind } from "./core/kind";
import { addRejection } from "./core/rejections";
import { addPref, globalCandidates, learnFromProject, promote, type Strength } from "./core/prefs";
import { primer, PRIMERS } from "./core/primers";
import { lookupRef, refTemplate, saveRef } from "./core/refs";
import { AGENTS_SNIPPET } from "./core/agents";
import { exportTokens, type Format } from "./core/export";
import { loadTokens } from "./core/tokens";
import { formatTaste, taste } from "./core/taste";

const USAGE = `gusteau: a taste layer for agents

  gusteau init "<what you're building>" [--name <name>] [--kind product|marketing|terminal] [--force]
  gusteau kind [product|marketing|terminal]
  gusteau brief
  gusteau export [--format css|ts] [--out <file>]
  gusteau check [--root <dir>] [--tokens <file>] [--json] [--limit <n>]
  gusteau taste <file or url> [--width <px>] [--json]
  gusteau learn --says "<pref>" [--why ..] [--instead ..] [--scope project|global] [--strength hard|strong|lean] [--tags a,b]
  gusteau learn --from-project
  gusteau reject --tried "<what was tried>" [--said "<their words>"] [--instead ..] [--scope project|global]
  gusteau candidates | promote <id or text>
  gusteau ref <name> | ref save <name> <file> | ref template
  gusteau component add <name> --level <level> [--role ..] [--uses a,b] [--tokens prop=path,..] [--files a,b] [--notes ..]
  gusteau component search <words> [--level <level>] | component list [--level <level>]
  gusteau primer <name>
  gusteau agents
  gusteau mcp
`;

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    root: { type: "string" }, tokens: { type: "string" }, json: { type: "boolean" }, limit: { type: "string" },
    name: { type: "string" }, force: { type: "boolean" }, kind: { type: "string" },
    tried: { type: "string" }, said: { type: "string" },
    says: { type: "string" }, why: { type: "string" }, instead: { type: "string" }, scope: { type: "string" },
    strength: { type: "string" }, tags: { type: "string" }, "from-project": { type: "boolean" },
    level: { type: "string" }, role: { type: "string" }, uses: { type: "string" }, files: { type: "string" }, notes: { type: "string" },
    format: { type: "string" }, out: { type: "string" }, width: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});
const [cmd, ...args] = positionals;
const list = (s?: string) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : undefined);
const fail = (msg: string): never => (console.error(msg), process.exit(2));
const root = o.root ?? process.cwd();
const kind = (s?: string) => (s && !KINDS.includes(s as Kind) ? fail(`kind is one of ${KINDS.join(", ")}`) : (s as Kind | undefined));
const level = (s?: string) => (s && !LEVELS.includes(s as Level) ? fail(`level is one of ${LEVELS.join(", ")}`) : (s as Level | undefined));

export function formatReport(r: Report, limit = 20): string {
  const lines = r.failures.slice(0, limit).map((f) => `[${f.severity}] ${f.where}  ${f.message}${f.fix ? `  → ${f.fix}` : ""}  (${f.rule})`);
  if (r.failures.length > limit) lines.push(`… ${r.failures.length - limit} more`);
  const c = r.coverage, list = (ids: string[]) => ids.join(", ") || "none";
  const s = r.scanned;
  lines.push(r.passed ? "passed" : `${r.failures.length} failing`,
    s.files ? `read ${s.files} files${s.ignored ? `; ${s.ignored} lines skipped by gusteau-ignore` : ""}`
      : "read no code: none of its files are CSS, HTML, JS/TS, Vue, Svelte, Astro or QML, so only tokens.json was checked",
    `of ${c.total} rules, checked in code: ${list(c.code)}`,
    `  in tokens.json only: ${list(c.tokens.filter((id) => !c.page.includes(id)))}`,
    `  on the rendered page, by gusteau taste: ${list(c.page)}`,
    `  unchecked: ${list(c.unchecked)}`);
  return lines.join("\n");
}

switch (cmd) {
  case "init": {
    const request = args.join(" ") || fail('say what you are building: gusteau init "<request>"');
    try {
      const { dir, tokens, fonts, kind: k } = initProject(root, request, { name: o.name, force: o.force, kind: kind(o.kind) });
      console.log(`wrote ${dir} for ${tokens.name} (${k})\nfonts ${tokens.font.heading} / ${tokens.font.body}: ${fonts}\naccent ${tokens.color.accent}`);
    } catch (e) { fail((e as Error).message); }
    break;
  }
  case "kind": {
    if (args[0]) saveKind(kind(args[0])!, root);
    console.log(loadKind(root));
    break;
  }
  case "brief": process.stdout.write(compileBrief(root)); break;
  case "export": {
    const format = (o.format ?? (o.out?.endsWith(".ts") ? "ts" : "css")) as Format;
    if (format !== "css" && format !== "ts") fail("--format is css or ts");
    const tokens = loadTokens(root) ?? fail("no tokens yet: run gusteau init");
    const text = exportTokens(tokens, format);
    if (o.out) { writeFileSync(o.out, text); console.log(`wrote ${o.out}`); } else process.stdout.write(text);
    break;
  }
  case "check": {
    const r = await check({ root, tokens: o.tokens });
    console.log(o.json ? JSON.stringify(r, null, 2) : formatReport(r, Number(o.limit ?? 20)));
    process.exit(r.passed ? 0 : 1);
  }
  case "taste": {
    const target = args[0] ?? fail("taste <file or url>: the page to render");
    try {
      const r = await taste(target, { root, width: o.width ? Number(o.width) : undefined });
      console.log(o.json ? JSON.stringify(r, null, 2) : formatTaste(r));
      process.exit(r.passed ? 0 : 1);
    } catch (e) { fail((e as Error).message); }
  }
  case "learn": {
    if (o["from-project"]) { const added = learnFromProject(root); console.log(`learned ${added.length} prefs and ${added.rejected.length} rejections from this project`); break; }
    const says = o.says ?? fail("learn needs --says or --from-project");
    const scope = (o.scope ?? "project") as "project" | "global";
    const p = addPref({ says, why: o.why, instead: o.instead, scope, strength: (o.strength ?? "strong") as Strength, tags: list(o.tags), source: "manual" }, root);
    console.log(`${p.id} (${p.scope}, ${p.strength})`);
    break;
  }
  case "reject": {
    const tried = o.tried ?? fail('reject needs --tried "<what was tried>"');
    const r = addRejection({ tried, said: o.said, instead: o.instead, scope: (o.scope ?? "project") as "project" | "global", source: "manual" }, root);
    console.log(`${r.id} (${r.scope})`);
    break;
  }
  case "candidates":
    for (const c of globalCandidates()) console.log(`${c.prefs[0]!.id}  ${c.says}  (${c.projects.length} projects)`);
    break;
  case "promote": {
    const p = promote(args.join(" ") || fail("promote <id or text>"));
    console.log(p ? `promoted ${p.id}: ${p.says}` : "no candidate by that id or text");
    break;
  }
  case "ref": {
    if (args[0] === "template") { process.stdout.write(refTemplate()); break; }
    if (args[0] === "save") {
      const [, name, file] = args;
      if (!name || !file) fail("ref save <name> <file>");
      console.log(`saved ${saveRef(name!, readFileSync(file!, "utf8"))}`);
      break;
    }
    const text = lookupRef(args.join(" ") || fail("ref <name>"));
    if (text) process.stdout.write(text); else { console.log("not found"); process.exit(1); }
    break;
  }
  case "component": {
    const [sub, ...rest] = args;
    if (sub === "add") {
      const name = rest.join(" ") || fail("component add <name> --level <level>");
      const tokens = list(o.tokens) && Object.fromEntries(list(o.tokens)!.map((kv) => kv.split("=") as [string, string]));
      const c = addComponent({ name, level: level(o.level) ?? fail("--level is required"), role: o.role, uses: list(o.uses), tokens, files: list(o.files), notes: o.notes }, root);
      console.log(`added ${c.level}/${c.slug}`);
    } else {
      const cs = sub === "search" ? searchComponents(rest.join(" "), root, level(o.level)) : loadComponents(root).filter((c) => !o.level || c.level === o.level);
      for (const c of cs) console.log(`${c.level.padEnd(8)} ${c.slug}${c.role ? `  ${c.role}` : ""}${c.uses?.length ? `  uses ${c.uses.join(", ")}` : ""}`);
    }
    break;
  }
  case "primer": {
    const text = primer(args[0] ?? "");
    if (text) process.stdout.write(text); else fail(`primers: ${Object.keys(PRIMERS).join(", ")}`);
    break;
  }
  case "agents": process.stdout.write(AGENTS_SNIPPET); break;
  case "mcp": await import("./mcp").then((m) => m.serve()); break;
  default: process.stdout.write(USAGE); if (cmd && !o.help) process.exit(2);
}
