# gusteau spec (v0)

gusteau is the infrastructure behind an agent's design taste. It holds what you
like, sets up each new UI project from it, and gives the agent a short brief
and a check to work against. The harness runs the loop; gusteau supplies the
goal.

## Two layers

| Layer | Where | Holds |
| --- | --- | --- |
| Global | `~/.gusteau/` (or `$GUSTEAU_HOME`) | rules (constraints), taste prefs, primers, reference sheets, internal history |
| Project | `./.gusteau/` | tokens (values), DESIGN.md, DECISIONS.md, review.json, prefs, component library |

Global sets limits, the project picks values. "Spacing sits on a 4px grid" is
global. "Spacing is 4, 8, 12, 20, 32" is the project's.

Precedence: task request > project > global > preset. A `hard` entry at any
layer can't be overridden by a lower-strength one above it.

## Records

A preference:

```yaml
id: p-1a2b3c
says: Hover states change value, never hue
why: Hue shifts read as a different element
instead: Hover that tints the accent toward another color
scope: global | project
strength: hard | strong | lean
tags: [color, interaction]
source: review | decision | manual
```

A rule (global, `rules.yaml`) is a checkable constraint with an id, a short
statement, and optional numeric bounds (`min`, `max`, `step`).

A component (`.gusteau/components/<level>/<slug>.md`) has YAML front matter:
`name`, `level` (atom, molecule, organism, template, page), `role`, `uses`
(other slugs), `tokens` (property to token path), `files`, then free notes.

## Commands

- `init` writes a project sheet from the global rules and the request. Value
  choices diverge from what earlier projects used; that happens in code, from
  internal history, and is never written into any prompt.
- `brief` prints the compact context an agent reads at task time.
- `learn` records a preference, or reads review.json and DECISIONS.md. A
  project preference seen in 2+ projects becomes a global candidate; it is
  promoted only when the user confirms (`promote <id>`).
- `ref <name>` returns a saved reference sheet, or `not found`.
  `ref save <name> <file>` stores one written from the template.
- `check` lints code for values that aren't tokens (CSS, JS/TS/JSX/TSX, QML,
  HTML, Vue, Svelte), checks the component library for contradictions, and
  reports failures ranked by severity plus rule coverage. Exit code 1 when
  anything fails, so a loop can run until it passes.
- `taste <page>` renders a page headless (playwright-core) and measures it:
  filled actions, accent uses, all caps, `!`, heavy text, empty space, the
  widest section break, contrast and line length. Preferences set the limits
  by their words; each finding names its preference or rule. Exit code 1 when
  anything fails.
- `export` writes the tokens as CSS custom properties or a TS module, marked
  as generated so `check` skips them.
- `component add | search | list` manages the atomic library.
- `mcp` serves all of the above over stdio.

## Absence over prohibition

What the agent should not do is left out, not forbidden. Briefs never name
other projects, never list the reference library, and never say "don't".
References are reachable only by asking for one by name. Divergence from past
projects is done by the code that generates values, never by instruction.

## Primers

`primers/*.md` are short reminders (elements, principles, typography, color,
layout, UX). The brief carries only their quick checks; the full text is one
`primer <name>` away.
