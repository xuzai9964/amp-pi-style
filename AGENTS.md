# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What this is

A pi package (`"keywords": ["pi-package"]`) that gives the [pi coding agent](https://github.com/earendil-works/pi) a Grok Build-inspired look: one TUI extension (`extensions/amp-style.ts`) plus two themes (`themes/amp-style.json`, `themes/amp-warm.json`). Purely visual — no agent behavior changes.

There is no build or lint setup. Run the Bun regression suite with `npm test` (or `bun test`). The extension is a single TypeScript entry module loaded directly by pi; themes are JSON validated against pi's theme schema (see the `$schema` URL in each theme file). To try changes, install into a local pi (`pi install git:github.com/xuzai9964/amp-pi-style`, or point pi at this checkout) and run pi interactively with `"theme": "amp-style"` and `"hideThinkingBlock": false` in `~/.pi/agent/settings.json` (visible thinking is recommended to match Grok's progressive-disclosure model).

## Architecture

The extension prefers **pi's official extension APIs where they exist** (`ctx.ui.setFooter`, `setWidget`, `setWorkingVisible`/`setWorkingIndicator`, `setStatus`, `notify`) and falls back to **prototype patching of pi's exported TUI classes at load time** for everything pi has no API for. The entry point `ampStyle(pi)` wires event listeners, then applies the patches:

- `wireEvents` — subscribes to extension events (`agent_start`, `message_update`, `tool_execution_start/end`, `session_shutdown`, …) to maintain reload-stable render state. While an event context is active, it copies model labels, context usage, cwd, and thinking level into plain values; renderers never retain or dereference a Pi context after session replacement. Shutdown clears session/activity/theme state and lets the live region and footer be installed again for the next session.
- `applyLiveRegion` — installs the turn-status row as Pi's official above-editor widget (`ctx.ui.setWidget`) and disables the stock working indicator through the official API. The widget owns the only activity indicator (two-cell Braille thinking-orbs via `extensions/orbs/`; `AMP_PI_ORBS=off` restores the legacy spinner) and its repaint timer, leaving a stable prompt gap; retry/compaction rows stay stock.
- `applyFooter` — replaces the stock footer via `ctx.ui.setFooter` with a separate agent-status row (abbreviated cwd/git at the left, context usage and `setStatus` lines at the right, minus `HIDDEN_STATUS_KEYS`). It never shares the prompt border.
- `patchUserMessages` / `patchAssistantMessages` — terminal-inheriting prompt rows with `❯` arrow, vertical rhythm, and aligned continuations; thinking gets a subdued `◆` header and `┃` rail while Pi keeps `ctrl+t` visibility behavior.
- `patchToolCards` — replaces `ToolExecutionComponent.render` with one-line Grok-style rows (`◆ Run cmd`, `◆ Read path`, `◆ Edit path +5 -1`, `✗ Run cmd` + invisible `CARD_MARK`); falls through to the original renderer when expanded (ctrl+o).
- `patchCardGrouping` — a line-level pass over the **final TUI render** that merges runs of adjacent same-category cards via `CARD_MARK` + `CARD_RE`, anchors the pinned lower frame to the live-region `LIVE_MARK`, turns Pi's queued-steering rows into a flat diamond summary row, and wraps the fullscreen root in one shared two-column `HStack` gutter. This depends on the exact card text produced by `patchToolCards` — change one, change both.
- `patchEditor` — rebuilds the editor into Grok's rounded prompt with no background paint: focus-aware quiet borders, a `❯` input prefix, and readable model/mode text in the bottom divider. Every composer row inherits the terminal. Scroll indicators remain. Finished box lines keep `width - 1` slack so Ghostty/iTerm do not auto-wrap a full-width row into the next border.
- Failed patches collect via `guard(name, ok)` and emit one load-time notice (`console.error` + `ctx.ui.notify`) so a silent stock-UI fallback is diagnosable.

## Conventions that matter

- **Every patch must be guarded.** Each checks `typeof orig === "function"` before wrapping and marks the prototype with `__ampStyle` (idempotence). If pi renames an internal, the patch must degrade to a no-op — stock UI, never a crash. Preserve this when adding patches.
- Rendered lines are manipulated as ANSI-styled strings: use `stripAnsi` before matching (also strips `FRAME_MARKS` incl. `CARD_MARK`), `colWidth`/`truncCols` for width math (CJK counts as 2 columns; `CARD_MARK`/BOM count 0), and `afterLeadingOsc` when prefixing a line — OSC 133 semantic-prompt marks must stay at the very start of a line or terminals like Ghostty/iTerm2 break it.
- `patchToolCards` output is matched by `CARD_RE` in `mergeToolCards` and by the final-frame pass; the exact `◆ Run …`/`◆ Read …`/`◆ Edit …`/`✗ Run …` text is a contract. Change one, change both.
- The turn-status widget emits `LIVE_MARK` on main-screen TUIs only; `pinComposer` prefers that anchor over `COMPOSER_MARK`. Both are stripped by the final-frame pass, so they must never reach the terminal as raw OSC.
- Border/label layout in `patchEditor` and the agent-status footer (`statusLine`) maintain parallel plain/styled strings so column math stays correct despite ANSI codes.
- Fullscreen horizontal spacing belongs at the root `HStack` via `SCREEN_GUTTER`, never as independent per-component padding. This keeps transcript, dock, selection, overlays, and wrap widths aligned.
- Themes define a `vars` palette referenced by name from `colors`; empty string means "inherit terminal color". Keep the two themes structurally in sync. Transcript and composer rows inherit the terminal; `selectedBg` remains available only for Pi-owned semantic surfaces such as selection and overlays.
- Thinking-orbs live under `extensions/orbs/` as a helper tree (no `index.ts`, so Pi does not load them as a second extension). Keep the turn-status row at height 1 and the orb at two Braille cells. Never inject Kitty APC into the mixed orb+phase row: pi-tui classifies the whole row as image-only and skips normal background composition. Phase→state mapping and `AMP_PI_ORBS` live in `extensions/orbs/render.ts`.

## Docs

The README's "What you get" and "How it works / caveats" sections and the extension's top-of-file comment describe the same behavior — update them together when the UI changes.
