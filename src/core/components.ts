import { join, relative } from "node:path";
import { frontMatter, projectDir, readText, slugify, walk, withFrontMatter, writeText } from "./store";
import type { Failure, Tokens } from "./tokens";

export const LEVELS = ["atom", "molecule", "organism", "template", "page"] as const;
export type Level = (typeof LEVELS)[number];
export type Component = {
  slug: string; name: string; level: Level; role?: string; uses?: string[];
  tokens?: Record<string, string>; files?: string[]; notes?: string; path?: string;
};

const dir = (root?: string) => join(projectDir(root), "components");

export function loadComponents(root?: string): Component[] {
  return walk(dir(root)).filter((p) => p.endsWith(".md")).map((path) => {
    const { data, body } = frontMatter(readText(path)!);
    return { ...data, slug: data.slug ?? path.split("/").pop()!.replace(/\.md$/, ""), notes: body.trim(), path } as Component;
  }).sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || a.slug.localeCompare(b.slug)); // readdir order differs by OS
}

export function addComponent(c: Omit<Component, "slug"> & { slug?: string }, root?: string): Component {
  const slug = c.slug ?? slugify(c.name);
  const { notes, path: _, ...data } = { ...c, slug };
  writeText(join(dir(root), c.level, slug + ".md"), withFrontMatter(data, notes ? notes + "\n" : ""));
  return { ...c, slug };
}

/** Match every query word against name, role, level, tokens and notes. */
export function searchComponents(query: string, root?: string, level?: Level): Component[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return loadComponents(root)
    .filter((c) => !level || c.level === level)
    .filter((c) => {
      const hay = [c.slug, c.name, c.role, c.level, c.notes, ...(c.uses ?? []), ...Object.entries(c.tokens ?? {}).flat()].join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    });
}

const tokenAt = (t: Tokens, path: string) => path.split(".").reduce<any>((o, k) => o?.[k], t);

/** Places where the library disagrees with itself or with the tokens. */
export function componentFailures(cs: Component[], tokens: Tokens | null, root = process.cwd()): Failure[] {
  const out: Failure[] = [];
  const by = new Map(cs.map((c) => [c.slug, c]));
  for (const c of cs) {
    const where = c.path ? relative(root, c.path) : c.slug;
    const f = (severity: number, rule: string, message: string) => out.push({ severity, rule, where, message });
    if (!LEVELS.includes(c.level)) { f(2, "components.level", `level "${c.level}" isn't one of ${LEVELS.join(", ")}`); continue; }
    for (const u of c.uses ?? []) {
      const dep = by.get(u);
      if (!dep) f(2, "components.uses", `uses "${u}", which isn't in the library`);
      else if (LEVELS.indexOf(dep.level) > LEVELS.indexOf(c.level)) f(2, "components.uses", `a ${c.level} can't be built from the ${dep.level} "${u}"`);
    }
    for (const [prop, ref] of Object.entries(c.tokens ?? {}))
      if (tokens && tokenAt(tokens, ref) === undefined) f(3, "values.tokens", `${prop} is "${ref}", which isn't a token`);
  }
  const roles = new Map<string, Component[]>();
  for (const c of cs) if (c.role) roles.set(c.level + ":" + c.role, [...(roles.get(c.level + ":" + c.role) ?? []), c]);
  for (const [key, group] of roles) {
    if (group.length < 2) continue;
    const props = new Set(group.flatMap((c) => Object.keys(c.tokens ?? {})));
    for (const prop of props) {
      const values = new Map(group.filter((c) => c.tokens?.[prop]).map((c) => [c.slug, c.tokens![prop]]));
      if (new Set(values.values()).size > 1)
        out.push({ severity: 2, rule: /radius/i.test(prop) ? "shape.radius" : "components.repetition", where: key.replace(":", " "), message: `${[...values].map(([s, v]) => `${s} uses ${v}`).join(", ")} for ${prop}; matching parts should match` });
    }
  }
  return out;
}
