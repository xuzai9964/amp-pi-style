# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What this is

A pi package (`"keywords": ["pi-package"]`) that gives the [pi coding agent](https://github.com/earendil-works/pi) an Amp-inspired look: one TUI extension (`extensions/amp-style.ts`) plus two themes (`themes/amp-style.json`, `themes/amp-warm.json`). Purely visual — no agent behavior changes.

There is no build, lint, or test setup. The extension is a single TypeScript module loaded directly by pi; themes are JSON validated against pi's theme schema (see the `$schema` URL in each theme file). To try changes, install into a local pi (`pi install git:github.com/xuzai9964/amp-pi-style`, or point pi at this checkout) and run pi interactively with `"theme": "amp-style"` and `"hideThinkingBlock": true` in `~/.pi/agent/settings.json`.

## Architecture

The extension prefers **pi's official extension APIs where they exist** (`ctx.ui.setFooter`, `setWidget`, `setStatus`, `notify`) and falls back to **prototype patching of pi's exported TUI classes at load time** for everything pi has no API for. The entry point `ampStyle(pi)` wires event listeners, then applies the patches:

- `wireEvents` — subscribes to extension events (`agent_start`, `message_update`, `tool_execution_start/end`, …) to maintain module-level live state (`lastCtx`, `workPhase`, `workTokens`, `activeTools`). This state is *read at render time*; live values like model, cost, and context usage are fetched through `lastCtx`'s getters, never cached from event snapshots (except two small time/count-based caches, `costCache` and `ctxUsageCache`).
- `patchUserMessages` / `patchAssistantMessages` — compact spacing, italic user text with a `▎` bar, thinking blocks filtered out when `hideThinkingBlock` is set.
- `patchToolCards` — replaces `ToolExecutionComponent.render` with one-line cards (`✓ Edited path +5 -1 ▸` + invisible `CARD_MARK`); falls through to the original renderer when expanded (ctrl+o).
- `patchCardGrouping` — a line-level pass over the **final TUI render** (`TUI.prototype.render`) that merges runs of adjacent same-category cards via `CARD_MARK` + `CARD_RE`. This depends on the exact card text produced by `patchToolCards` — change one, change both.
- `applyFooter` — replaces the footer via the official `ctx.ui.setFooter` API (renders only `ctx.ui.setStatus` lines, dimmed, minus `HIDDEN_STATUS_KEYS` — e.g. pi-cursor-sdk's `cursor` status, redundant with the border's model); applied once on the first event whose ctx has a UI. Degrades to the stock footer with a notice if the API is missing.
- `patchChrome` — blanks the stock `Working...` loader (keeps its 2-line height to avoid layout flapping). **Deliberately a prototype patch, not `setWorkingVisible(false)`**: the working loader's animation timer is what repaints the border spinner between stream events; `setWorkingVisible(false)` would remove the timer with it.
- `patchEditor` — rebuilds the editor's border lines to embed live info (cost/model/ctx%/thinking level on top; work status and abbreviated cwd on the bottom). Finished box lines use `width - 1` (2 side borders + 1 slack) so Ghostty/iTerm do not auto-wrap a full-width row into the next border.
- Failed patches collect via `guard(name, ok)` and emit one load-time notice (`console.error` + `ctx.ui.notify`) so a silent stock-UI fallback is diagnosable.

## Conventions that matter

- **Every patch must be guarded.** Each checks `typeof orig === "function"` before wrapping and marks the prototype with `__ampStyle` (idempotence). If pi renames an internal, the patch must degrade to a no-op — stock UI, never a crash. Preserve this when adding patches.
- Rendered lines are manipulated as ANSI-styled strings: use `stripAnsi` before matching (also strips `CARD_MARK`), `colWidth`/`truncCols` for width math (CJK counts as 2 columns; `CARD_MARK`/BOM count 0), and `afterLeadingOsc` when prefixing a line — OSC 133 semantic-prompt marks must stay at the very start of a line or terminals like Ghostty/iTerm2 break it.
- Border/label layout in `patchEditor` maintains parallel `plain`/`styled` strings so column math stays correct despite ANSI codes.
- Themes define a `vars` palette referenced by name from `colors`; empty string means "inherit terminal color". Keep the two themes structurally in sync.

## Docs

The README's "What you get" and "How it works / caveats" sections and the extension's top-of-file comment describe the same behavior — update them together when the UI changes.
