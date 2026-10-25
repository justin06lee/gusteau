import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { frontMatter, globalHome, readText, slugify, writeText } from "./store";
import template from "../../templates/reference-sheet.md" with { type: "text" };

const dir = () => join(globalHome(), "refs");
export const refTemplate = () => template;

/** A saved reference sheet by name or alias, or null. The library is only ever reached by name. */
export function lookupRef(name: string): string | null {
  const slug = slugify(name);
  const direct = readText(join(dir(), slug + ".md"));
  if (direct) return direct;
  if (!existsSync(dir())) return null;
  for (const file of readdirSync(dir())) {
    const text = readText(join(dir(), file))!;
    const aliases: string[] = frontMatter(text).data.aliases ?? [];
    if (aliases.some((a) => slugify(a) === slug)) return text;
  }
  return null;
}

export function saveRef(name: string, text: string): string {
  const path = join(dir(), slugify(name) + ".md");
  writeText(path, text);
  return path;
}
