import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { compileBrief } from "./core/brief";
import { check } from "./core/check";
import { exportTokens } from "./core/export";
import { taste } from "./core/taste";
import { loadTokens } from "./core/tokens";
import { addComponent, LEVELS, searchComponents } from "./core/components";
import { initProject } from "./core/init";
import { KINDS } from "./core/kind";
import { addPref } from "./core/prefs";
import { addRejection } from "./core/rejections";
import { primer } from "./core/primers";
import { lookupRef, refTemplate, saveRef } from "./core/refs";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const root = z.string().optional().describe("Project root; defaults to the working directory");

export function server(): McpServer {
  const s = new McpServer({ name: "gusteau", version: "0.1.0" });

  s.registerTool("brief", { description: "The design brief for this project: the user's taste, this project's prefs and tokens, what was turned down, and limits.", inputSchema: { root } },
    async (a) => text(compileBrief(a.root)));
  s.registerTool("check", { description: "What's off in the code and the component library, worst first. Fix the top item and run it again until it passes.", inputSchema: { root, tokens: z.string().optional().describe("Token file, if not .gusteau/tokens.json") } },
    async (a) => text(JSON.stringify(await check({ root: a.root, tokens: a.tokens }), null, 2)));
  s.registerTool("taste", { description: "Render a page (file or URL) and measure it against the user's preferences and the rules a value lint can't see: filled actions, accent use, all caps, '!', whitespace, contrast, line length.", inputSchema: { root, target: z.string().describe("HTML file or URL"), width: z.number().optional() } },
    async (a) => text(JSON.stringify(await taste(a.target, { root: a.root, width: a.width }), null, 2)));
  s.registerTool("export", { description: "The tokens as CSS custom properties or a TS module, for code to import instead of writing raw values.", inputSchema: { root, format: z.enum(["css", "ts"]).optional() } },
    async (a) => { const t = loadTokens(a.root); return text(t ? exportTokens(t, a.format ?? "css") : "no tokens yet: run init"); });
  s.registerTool("init", { description: "Set up a project's design sheet from what the user is building.", inputSchema: { root, request: z.string(), name: z.string().optional(), kind: z.enum(KINDS).optional().describe("product, marketing or terminal; read from the request if left out"), force: z.boolean().optional() } },
    async (a) => text(JSON.stringify(initProject(a.root ?? process.cwd(), a.request, { name: a.name, force: a.force, kind: a.kind }).tokens, null, 2)));
  s.registerTool("ref_lookup", { description: "The saved design sheet for a named company or product, or 'not found'.", inputSchema: { name: z.string() } },
    async (a) => text(lookupRef(a.name) ?? "not found"));
  s.registerTool("ref_template", { description: "The outline for a new reference sheet.", inputSchema: {} },
    async () => text(refTemplate()));
  s.registerTool("ref_save", { description: "Save a reference sheet written from the template.", inputSchema: { name: z.string(), sheet: z.string() } },
    async (a) => text(`saved ${saveRef(a.name, a.sheet)}`));
  s.registerTool("learn", {
    description: "Record a design preference the user stated or approved.",
    inputSchema: { root, says: z.string(), why: z.string().optional(), instead: z.string().optional(), scope: z.enum(["project", "global"]).optional(), strength: z.enum(["hard", "strong", "lean"]).optional(), tags: z.array(z.string()).optional() },
  }, async (a) => text(JSON.stringify(addPref({ says: a.says, why: a.why, instead: a.instead, scope: a.scope ?? "project", strength: a.strength ?? "strong", tags: a.tags, source: "manual" }, a.root))));
  s.registerTool("reject", {
    description: "Record something the user tried and turned down, in their words, with what they chose instead.",
    inputSchema: { root, tried: z.string(), said: z.string().optional(), instead: z.string().optional(), scope: z.enum(["project", "global"]).optional() },
  }, async (a) => text(JSON.stringify(addRejection({ tried: a.tried, said: a.said, instead: a.instead, scope: a.scope ?? "project", source: "manual" }, a.root))));
  s.registerTool("component_search", { description: "Find pieces already in this project's component library.", inputSchema: { root, query: z.string(), level: z.enum(LEVELS).optional() } },
    async (a) => text(JSON.stringify(searchComponents(a.query, a.root, a.level), null, 2)));
  s.registerTool("component_add", {
    description: "Record a reusable piece in the component library.",
    inputSchema: { root, name: z.string(), level: z.enum(LEVELS), role: z.string().optional(), uses: z.array(z.string()).optional(), tokens: z.record(z.string(), z.string()).optional(), files: z.array(z.string()).optional(), notes: z.string().optional() },
  }, async ({ root: r, ...c }) => text(JSON.stringify(addComponent(c, r))));
  s.registerTool("primer", { description: "A short design primer: elements, principles, typography, color, layout, ux.", inputSchema: { name: z.string() } },
    async (a) => text(primer(a.name) ?? "not found"));
  return s;
}

export async function serve() {
  await server().connect(new StdioServerTransport());
}
