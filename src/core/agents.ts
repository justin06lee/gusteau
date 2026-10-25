/** The snippet a harness drops into AGENTS.md / CLAUDE.md so its agent uses gusteau. */
export const AGENTS_SNIPPET = `## Design

This project keeps its design sheet in \`.gusteau/\`. Before UI work, read \`gusteau brief\`.
While building, \`gusteau check\` lists what's off: fix the top item and run it again until it passes.
When a request names another company's or product's look, \`gusteau ref <name>\` returns its saved sheet;
if there is none, research that design and save one with \`gusteau ref save <name> <file>\`
(\`gusteau ref template\` prints the outline).
When the user approves or corrects a design choice, record it with \`gusteau learn --says "..." --why "..."\`.
New reusable pieces go in the library: \`gusteau component add <name> --level atom|molecule|organism|template|page\`.
`;
