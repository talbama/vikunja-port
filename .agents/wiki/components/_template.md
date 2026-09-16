# <Component name>

<One or two sentences: what this component is responsible for and where it sits in the architecture. Link the relevant foundation page.>

## Responsibility

- What it owns, what it explicitly does not own (and who does).

## Entry points and public API

| Entry | Where | Called by |
|---|---|---|
| `FunctionOrType` | `pkg/x/y.go` | `pkg/routes/...` |

## Key types and functions

Table or bullets: name, file, one line on what it does. Point at code; snippets under ten lines only when the shape matters.

## Internal structure

How the pieces fit. A Mermaid diagram (flowchart or sequence) when there is a flow worth seeing; otherwise a short list.

## Dependencies

- **Uses:** packages/modules this depends on.
- **Used by:** who calls into it.

## Invariants and assumptions

Things that must stay true. Each one names the code that relies on it.

## Configuration

| Key (`config.yml`) | Env var | Effect |
|---|---|---|

Omit if none.

## Error handling

Which errors it raises (`ErrCode*`), how failures surface (HTTP status, log, Sentry, poison queue), what is swallowed.

## Tests

Where its tests live, how to run just them (`mage test:filter ...`, `pnpm vitest run ...`), what is not covered.

## Gotchas and tech debt

Concrete, sourced items. Include TODO/FIXME comments with file:line, hotspot history if known, security-relevant history (GHSA ids).

## Related pages

Links to sibling component pages, playbooks, and foundation pages.
