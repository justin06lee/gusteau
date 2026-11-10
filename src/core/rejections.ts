import { join } from "node:path";
import { appliesTo, loadKind, type Kind } from "./kind";
import { globalHome, projectDir, readYaml, shortId, writeYaml } from "./store";

/** Something tried and turned down: the strongest taste signal, kept apart from what the user asked for. */
export type Rejection = {
  id: string; tried: string; said?: string; instead?: string; when?: string;
  scope: "global" | "project"; kinds?: Kind[]; source?: "review" | "decision" | "manual";
};

const path = (scope: Rejection["scope"], root?: string) => (scope === "global" ? join(globalHome(), "rejections.yaml") : join(projectDir(root), "rejections.yaml"));
export const loadRejections = (scope: Rejection["scope"], root?: string) => readYaml<Rejection[]>(path(scope, root), []);

export function addRejection(r: Omit<Rejection, "id"> & { id?: string }, root?: string): Rejection {
  const rej = { ...r, id: r.id ?? shortId("r", r.scope + r.tried), when: r.when ?? new Date().toISOString().slice(0, 10) } as Rejection;
  const all = loadRejections(rej.scope, root).filter((x) => x.id !== rej.id);
  writeYaml(path(rej.scope, root), [...all, rej]);
  return rej;
}

/** This project's rejections, then the global ones, for this kind of project. */
export function effectiveRejections(root?: string, kind: Kind = loadKind(root)): Rejection[] {
  return [...loadRejections("project", root), ...loadRejections("global")].filter((r) => appliesTo(r, kind));
}
