# amp-pi-style

Grok-informed visual styling for the [pi coding agent](https://github.com/earendil-works/pi): one owned matte canvas, a calm engineering transcript, operation-first tools, and live state close to the composer. The package and theme names remain unchanged for backward compatibility.

The update draws from [xai-org/grok-build](https://github.com/xai-org/grok-build), adapting only presentation patterns that Pi can represent safely. See [DESIGN_LANGUAGE.md](./DESIGN_LANGUAGE.md) for the detailed Chinese-language design model.

## What you get

**Transcript first**

- Flat, single-column rendering with no chat bubbles, no transcript cards, one stable blank line between blocks, and a shared two-column fullscreen gutter.
- User prompts stay on the same canvas as the transcript and use only a `❯` arrow plus vertical rhythm. Wrapped and explicit continuation lines align beneath the prompt without disturbing OSC semantic-prompt marks.
- Assistant responses remain plain, incrementally rendered Markdown. Pi owns thinking visibility and `ctrl+t`; visible thinking is recommended to match Grok's progressive-disclosure model.
- Completed tools become expandable semantic summaries:

```text
◆ Search terminal unicode width
◆ Read src/config.ts
◆ Edit src/config.ts +5 -1
✗ Run npm test
```

- Running tool rows use a quiet static dot while the dedicated turn-status row owns Grok's Braille activity sequence; `◆` marks a finished row, and `✗` remains reserved for failure.
- Adjacent command, search, read, and edit cards compress into bounded work summaries such as `◆ Ran 15 commands · 2 failed` and `◆ Edited 4 files +83 -17`.
- `ctrl+o` always returns to Pi's full renderer, so compact presentation never removes diagnostic detail.

**Live region: turn-status row, quiet prompt, agent-status footer**

```text
⠋ Editing 2 files…
╭───────────────────────────────────────────╮
│ ❯ next instruction                        │
╰─ claude-sonnet-4 ─ high ──────────────────╯
~/repo/app ⭠ main              18%  extension state
```

- A dedicated turn-status row sits above the prompt: the only activity spinner, one stable line that never shifts the editor. It replaces Pi's stock `Working...` indicator (disabled through the official API), so `Thinking…`, `Responding…`, `Searching 2 patterns…`, `Running 3 commands…`, `Reading 1 file…`, or `Editing 2 files…` live there instead of in the border.
- The rounded prompt uses quiet borders that only brighten when focused, a `❯` input prefix, and keeps model/mode information in its bottom divider. Scroll indicators such as `↑ 4 more` and `↓ 2 more` remain intact.
- The footer becomes a separate agent-status row that never shares the prompt border: abbreviated cwd and git branch at the left, context usage and extension statuses at the right.
- Queued steering becomes a flat diamond summary row: the latest instruction stays visible, multiple queued messages compress to a count, and `Enter to steer` keeps the interaction discoverable.
- The cwd keeps its origin and meaningful tail with middle elision, for example `~/Library/…/project/src`.
- Experimental pinned-composer mode keeps the lower frame at the terminal bottom while a short transcript grows upward; it defaults on for macOS and remains environment-toggleable.
- Retry and compaction notices remain stock.

**Single opaque canvas in fullscreen**

- In fullscreen (alternate-screen) mode the extension owns the final frame and paints every rewritten cell, reset span, and right-side padding column onto one opaque canvas. Transcript, user prompts, tools, live status, composer, and footer therefore read as one continuous matte surface, even in translucent or blurred terminals.
- Selection, overlays, and semantic diff states are the only deliberate raised surfaces. Ordinary user, assistant, custom, pending, successful, and failed tool rows do not receive independent backgrounds.
- The canvas comes from the theme's `vars.canvas`, is overridable with `AMP_PI_CANVAS=#1a1a1a`, and `AMP_PI_CANVAS=0` restores terminal-inheriting behavior. Inline mode always inherits the terminal so scrollback is never flooded with colored blocks.

**Quiet semantic themes**

- `amp-style`: values traced directly to Grok Build's `groknight.rs`: `#141414` canvas, neutral `#323237`/`#505058` prompt chrome, restrained violet activity, green success, yellow warning, and pink-red errors.
- `amp-warm`: the same neutral focus chrome and flat-canvas structure with warm semantic accents and cream text.
- User prompts and ordinary tool states share the canvas. Only selection, overlays, and semantic diff states step away from it.
- Color reinforces meaning but does not create it. `◆`, `✗`, action words, and counts remain understandable under limited-color or `NO_COLOR` conditions.

## Responsive behavior

The renderer uses Pi TUI's ANSI-, grapheme-, emoji-, and CJK-aware width primitives.

- Compact tool cards reserve one terminal column to avoid hard-wrap artifacts; below 8 columns they use Pi's stock renderer.
- Narrow cards drop diff statistics before shortening the action and target.
- Grouping begins at 16 columns. Narrower views keep the already bounded individual cards instead.
- Grouped failures retain the group marker, action count, and failed count before less important statistics.
- Composer box lines and the turn-status row also keep one slack column so Ghostty/iTerm never auto-wrap a full-width row into the next border.
- The agent-status footer drops whole right-side items (context usage before extension statuses) before ever trimming the identity-bearing left side.
- The two-column fullscreen gutter disappears below 12 columns so the content keeps a usable minimum width.
- Below 24 columns, the editor safely falls back to Pi's stock renderer.
- Leading OSC 133 sequences remain at the start of prefixed and rebuilt lines for Ghostty, iTerm2, and other semantic-prompt terminals.

## Install

```bash
pi install git:github.com/xuzai9964/amp-pi-style
```

Then configure `~/.pi/agent/settings.json`, or use `/settings` in Pi:

```json
{
  "theme": "amp-style",
  "hideThinkingBlock": false
}
```

Pi renders thinking normally when `hideThinkingBlock` is false. If you enable it, the extension delegates hiding and reversible `ctrl+t` behavior entirely to Pi.

### Experimental pinned composer

Pinned composer defaults on for macOS and off on other platforms. Override either default before launching Pi:

```bash
AMP_PI_PIN_COMPOSER=1 pi  # enable
AMP_PI_PIN_COMPOSER=0 pi  # disable
```

The toggle also accepts `true`/`false`, `yes`/`no`, and `on`/`off` (case-insensitive). When the rendered session is shorter than the terminal, the extension inserts flexible blank rows immediately before the active composer. Those rows yield as transcript content grows, so new content pushes upward while the lower frame stays at the bottom. Once content exceeds the terminal height, Pi's normal bottom viewport takes over.

### Opaque fullscreen canvas

In fullscreen mode the extension paints every rewritten cell and its remaining row width onto an opaque canvas (each shipped theme defines its `vars.canvas`), so the interface no longer depends on the terminal's background. Full and background-only SGR resets are immediately followed by the canvas color, preventing terminal-default holes inside composed rows. This is useful on translucent terminals or terminals whose theme clashes with the palette:

```bash
AMP_PI_CANVAS=#1a1a1a pi   # override the canvas color
AMP_PI_CANVAS=0 pi         # inherit the terminal background (default behavior of older releases)
```

The canvas pass is fullscreen-only and uses a guarded alternate-screen renderer patch because Pi has no official final-frame background API. If that internal changes, the extension safely falls back to terminal inheritance. Set the variable before starting Pi; changing it requires a restart.

## How it works

The extension prefers Pi's official APIs where they exist. It installs the turn-status row through `ctx.ui.setWidget` (above the editor) and replaces the footer through `ctx.ui.setFooter`, and it disables Pi's stock working indicator through the official `setWorkingVisible`/`setWorkingIndicator` API — the turn-status widget owns its own repaint timer.

Pi does not expose official APIs for every visual surface, so user messages, assistant spacing, thinking, tool summaries, card grouping, the fullscreen root gutter, and editor chrome use guarded prototype patches. Every patch checks that its target exists and marks itself for idempotence. Missing or renamed internals produce one diagnostic notice and use safe or stock behavior instead of crashing the agent.

Live model, thinking, context, and cwd values are copied from active extension events into plain render snapshots. The snapshots are cleared on `session_shutdown`, so session replacement and reload never leave guarded Pi contexts inside timer-driven render paths. Collapsed cards carry an invisible marker, so the final transcript pass never merges lookalike assistant text. That same bounded pass recognizes Pi's own queued-steering rows and turns them into the flat diamond summary row without changing queue behavior.

In fullscreen mode, the extension wraps the alternate-screen renderer and repaints every row it rewrites onto the opaque canvas color. It reapplies the canvas after full SGR and background resets, then fills the untouched width to the terminal edge. Image rows are prefilled before their Kitty/iTerm transport payload is emitted unchanged. Canvas changes force one full redraw so differential rendering cannot retain the old color; cursor and synchronized-output suffixes remain outside row paint. If Pi renames an internal, the canvas patch degrades to terminal-inheriting rendering rather than crashing.

When pinned composer is enabled, the main-screen turn-status widget emits an invisible live-region marker and the editor emits a separate composer fallback marker. The final-frame pass prefers exactly one live-region marker, otherwise requires exactly one composer marker, before padding to the current terminal height; dialogs, unsupported custom editors, and incompatible internals therefore fall back without guessing.

## Deliberate scope

This package is purely visual. Grok's typed/selectable scrollback, queue editing and send-now semantics, turn stop/background controls, elapsed timers, prompting, tool policy, and agent behavior are not reproduced. Pi continues to own command palette, sessions, notifications, model selection, tool execution, thinking, response generation, and queue behavior. The extension adapts only transferable renderer ideas: prompt hierarchy, operation-first summaries, semantic grouping, stable geometry, activity language, color, and graceful degradation.

## License

MIT
