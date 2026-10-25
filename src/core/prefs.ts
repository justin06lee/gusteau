import { join } from "node:path";
import { loadHistory } from "./tokens";
import { globalHome, projectDir, readJson, readText, readYaml, shortId, writeYaml } from "./store";

export type Strength = "hard" | "strong" | "lean";
export type Pref = {
  id: string; says: string; why?: string; instead?: string;
  scope: "global" | "project"; strength: Strength; tags?: string[];
  source?: "review" | "decision" | "manual"; overrides?: string;
};

const path = (scope: Pref["scope"], root?: string) => (scope === "global" ? join(globalHome(), "prefs.yaml") : join(projectDir(root), "prefs.yaml"));
export const loadPrefs = (scope: Pref["scope"], root?: string) => readYaml<Pref[]>(path(scope, root), []);

export function addPref(p: Omit<Pref, "id"> & { id?: string }, root?: string): Pref {
  const pref = { ...p, id: p.id ?? shortId("p", p.scope + p.says) } as Pref;
  const all = loadPrefs(pref.scope, root).filter((x) => x.id !== pref.id);
  writeYaml(path(pref.scope, root), [...all, pref]);
  return pref;
}

const RANK: Record<Strength, number> = { hard: 3, strong: 2, lean: 1 };

/** Task > project > global, except that a hard entry can only be overridden by another hard one. */
export function effectivePrefs(root?: string): { global: Pref[]; project: Pref[] } {
  const project = loadPrefs("project", root);
  const global = loadPrefs("global").filter((g) => {
    const over = project.find((p) => p.overrides === g.id);
    return !over || (g.strength === "hard" && RANK[over.strength] < RANK.hard);
  });
  return { global, project };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

/** Project prefs that recur in two or more projects and aren't global yet. */
export function globalCandidates(): { says: string; prefs: Pref[]; projects: string[] }[] {
  const global = new Set(loadPrefs("global").map((g) => norm(g.says)));
  const seen = new Map<string, { says: string; prefs: Pref[]; projects: string[] }>();
  for (const h of loadHistory())
    for (const p of loadPrefs("project", h.root)) {
      const k = norm(p.says);
      if (global.has(k)) continue;
      const e = seen.get(k) ?? { says: p.says, prefs: [], projects: [] };
      if (!e.projects.includes(h.project)) e.projects.push(h.project), e.prefs.push(p);
      seen.set(k, e);
    }
  return [...seen.values()].filter((e) => e.projects.length >= 2);
}

export function promote(says: string): Pref | null {
  const c = globalCandidates().find((x) => norm(x.says) === norm(says) || x.prefs.some((p) => p.id === says));
  if (!c) return null;
  const top = c.prefs.reduce((a, b) => (RANK[b.strength] > RANK[a.strength] ? b : a));
  return addPref({ says: top.says, why: top.why, instead: top.instead, scope: "global", strength: top.strength, tags: top.tags, source: top.source });
}

export type Decision = { id?: string; title: string; status: string; why?: string; instead?: string };

/** Parse DECISIONS.md: `## Title`, `Status:`, optional `Id:`, `**Why:**` and `**Instead of:**` paragraphs. */
export function parseDecisions(text: string): Decision[] {
  return text.split(/^## /m).slice(1).map((sec) => {
    const [title, ...rest] = sec.split("\n");
    const body = rest.join("\n");
    const para = (label: string) => body.match(new RegExp(`\\*\\*${label}:\\*\\*\\s*([\\s\\S]*?)(?=\\n\\s*\\n|$)`))?.[1].replace(/\s+/g, " ").trim();
    return {
      id: body.match(/^Id:\s*(\S+)/m)?.[1], title: title.trim(),
      status: body.match(/^Status:\s*(\w+)/m)?.[1] ?? "accepted", why: para("Why"), instead: para("Instead of"),
    };
  });
}

/** What the user said on review items: `{ items: { id: { verdict?, thread: [{ author, text }] } } }`. */
export function parseReview(json: any): { item: string; verdict?: string; said: string[] }[] {
  return Object.entries(json?.items ?? {}).map(([item, v]: [string, any]) => ({
    item, verdict: v.verdict, said: (v.thread ?? []).filter((m: any) => m.author === "you").map((m: any) => m.text),
  }));
}

/** Turn a project's decisions and review replies into project prefs. */
export function learnFromProject(root?: string, files = { decisions: "DECISIONS.md", review: "review.json" }) {
  const dir = projectDir(root);
  const added: Pref[] = [];
  for (const d of parseDecisions(readText(join(dir, files.decisions)) ?? ""))
    if (d.status === "accepted")
      added.push(addPref({ id: d.id && "p-" + d.id, says: d.title, why: d.why, instead: d.instead, scope: "project", strength: "strong", source: "decision" }, root));
  for (const r of parseReview(readJson(join(dir, files.review), {})))
    for (const said of r.said)
      added.push(addPref({ says: said, scope: "project", strength: r.verdict === "change" ? "strong" : "lean", tags: [r.item], source: "review" }, root));
  return added;
}
