import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const globalHome = () => process.env.GUSTEAU_HOME ?? join(homedir(), ".gusteau");
export const projectDir = (root = process.cwd()) => join(root, ".gusteau");

export function readText(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}
export function writeText(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
export function readYaml<T>(path: string, fallback: T): T {
  const text = readText(path);
  return text == null ? fallback : ((Bun.YAML.parse(text) as T) ?? fallback);
}
export const writeYaml = (path: string, data: unknown) => writeText(path, Bun.YAML.stringify(data, null, 2) + "\n");
export function readJson<T>(path: string, fallback: T): T {
  const text = readText(path);
  return text == null ? fallback : (JSON.parse(text) as T);
}
export const writeJson = (path: string, data: unknown) => writeText(path, JSON.stringify(data, null, 2) + "\n");

/** Every regular file under `dir`, skipping build output, dependencies and symlinks. */
export function walk(dir: string, skip = SKIP): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const path = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(path, skip));
    else if (e.isFile()) out.push(path);
  }
  return out;
}
const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", ".gusteau", "vendor", ".ruri"]);

export const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const shortId = (prefix: string, s: string) => prefix + "-" + Bun.hash(s).toString(36).slice(0, 6);

/** Split `---\nyaml\n---\nbody` into its parts. */
export function frontMatter(text: string): { data: Record<string, any>; body: string } {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  return m ? { data: (Bun.YAML.parse(m[1]) as any) ?? {}, body: m[2] } : { data: {}, body: text };
}
export const withFrontMatter = (data: unknown, body = "") => `---\n${Bun.YAML.stringify(data, null, 2)}\n---\n${body}`;
