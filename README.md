# amp-pi-style

Grok-informed visual styling for the [pi coding agent](https://github.com/earendil-works/pi): a terminal-native canvas, a quiet rounded composer, operation-first tools, and readable live state close to the prompt. The package and theme names remain unchanged for backward compatibility.

The update draws from [xai-org/grok-build](https://github.com/xai-org/grok-build), adapting only presentation patterns that Pi can represent safely. See [DESIGN_LANGUAGE.md](./DESIGN_LANGUAGE.md) for the detailed Chinese-language design model.

## What you get

**Transcript first**

- Flat, single-column rendering with no chat bubbles, no transcript cards, one stable blank line between blocks, and a shared two-column fullscreen gutter.
- User prompt echoes inherit the terminal background and use only a `❯` arrow plus vertical rhythm. Wrapped and explicit continuation lines align beneath the prompt without disturbing OSC semantic-prompt marks.
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
⢎⡴ Editing 2 files…
╭───────────────────────────────────────────╮
│ ❯ next instruction                        │
╰─ claude-sonnet-4 ─ high ──────────────────╯
~/repo/app ⭠ main              18%  extension state
```

- A dedicated turn-status row sits above the prompt: the only activity indicator, one stable line that never shifts the editor. It replaces Pi's stock `Working...` indicator (disabled through the official API). By default the indicator is a cute two-cell Braille port of [thinking-orbs](https://orbs.jakubantalik.com), mapped by phase — `Thinking…` breathes, `Searching…` scans, `Editing…` morphs shapes, `Responding…` composes, and so on. Braille keeps the row on pi-tui's normal text/background path; inline Kitty graphics are intentionally avoided because pi-tui treats mixed image-and-text rows as image-only. Set `AMP_PI_ORBS=off` to restore the legacy spinner.
- The rounded prompt fully inherits the terminal background. Its borders brighten when focused, a `❯` prefixes input, and high-contrast model/mode information stays visible in the bottom divider. Scroll indicators such as `↑ 4 more` and `↓ 2 more` remain intact.
- The footer becomes a separate agent-status row that never shares the prompt border: readable cwd and git branch at the left, context usage and extension statuses at the right.
- Queued steering becomes a flat diamond summary row: the latest instruction stays visible, multiple queued messages compress to a count, and `Enter to steer` keeps the interaction discoverable.
- The cwd keeps its origin and meaningful tail with middle elision, for example `~/Library/…/project/src`.
- Experimental pinned-composer mode keeps the lower frame at the terminal bottom while a short transcript grows upward; it defaults on for macOS and remains environment-toggleable.
- Retry and compaction notices remain stock.

**Terminal-native canvas, quiet composer**

- Fullscreen and inline modes both inherit the terminal background. The extension does not paint blank rows, transcript lines, or the full alternate screen black.
- The composer also inherits the terminal background on every row, including its borders and input line.
- Selection, overlays, and semantic diff states keep their normal Pi backgrounds.

**Quiet semantic themes**

- `amp-style`: values traced directly to Grok Build's `groknight.rs`: neutral `#323237`/`#505058` prompt chrome, restrained violet activity, green success, yellow warning, and pink-red errors.
- `amp-warm`: the same terminal-inheriting structure with warm semantic accents and cream text.
- Transcript, tools, and composer rows inherit the terminal; only Pi-owned selection, overlays, and semantic diff states receive backgrounds.
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

### Thinking orbs

The turn-status activity indicator ports the MIT [thinking-orbs](https://github.com/Jakubantalik/thinking-orbs) animation math into a software rasterizer, then samples each frame into a 2-cell Braille glyph. Phase → state mapping:

| Phase | Orb state |
| --- | --- |
| Thinking… | breathing |
| Responding… | composing |
| Searching… | searching |
| Running commands… | working |
| Reading… | connecting |
| Editing… | shaping |
| Running tools… | weaving |

```bash
AMP_PI_ORBS=auto pi     # default: animated two-cell Braille orb
AMP_PI_ORBS=braille pi  # explicitly select the same safe backend
AMP_PI_ORBS=off pi      # legacy Braille spinner (⠋⠙⠹…)
```

## How it works

The extension prefers Pi's official APIs where they exist. It installs the turn-status row through `ctx.ui.setWidget` (above the editor) and replaces the footer through `ctx.ui.setFooter`, and it disables Pi's stock working indicator through the official `setWorkingVisible`/`setWorkingIndicator` API — the turn-status widget owns its own repaint timer.

Pi does not expose official APIs for every visual surface, so user messages, assistant spacing, thinking, tool summaries, card grouping, the fullscreen root gutter, and editor chrome use guarded prototype patches. Every patch checks that its target exists and marks itself for idempotence. Missing or renamed internals produce one diagnostic notice and use safe or stock behavior instead of crashing the agent.

Live model, thinking, context, and cwd values are copied from active extension events into plain render snapshots. The snapshots are cleared on `session_shutdown`, so session replacement and reload never leave guarded Pi contexts inside timer-driven render paths. Collapsed cards carry an invisible marker, so the final transcript pass never merges lookalike assistant text. That same bounded pass recognizes Pi's own queued-steering rows and turns them into the flat diamond summary row without changing queue behavior.

The composer patch rebuilds only foreground chrome: rounded borders, the `❯` input prefix, and model/mode labels. It preserves leading OSC semantic-prompt marks and emits no background paint, so the entire editor, fullscreen transcript, and terminal scrollback inherit the terminal.

When pinned composer is enabled, the main-screen turn-status widget emits an invisible live-region marker and the editor emits a separate composer fallback marker. The final-frame pass prefers exactly one live-region marker, otherwise requires exactly one composer marker, before padding to the current terminal height; dialogs, unsupported custom editors, and incompatible internals therefore fall back without guessing.

## Deliberate scope

This package is purely visual. Grok's typed/selectable scrollback, queue editing and send-now semantics, turn stop/background controls, elapsed timers, prompting, tool policy, and agent behavior are not reproduced. Pi continues to own command palette, sessions, notifications, model selection, tool execution, thinking, response generation, and queue behavior. The extension adapts only transferable renderer ideas: prompt hierarchy, operation-first summaries, semantic grouping, stable geometry, activity language, color, and graceful degradation.

## License

MIT. Thinking-orb animation math is adapted from [Jakubantalik/thinking-orbs](https://github.com/Jakubantalik/thinking-orbs) (MIT); see [NOTICE](./NOTICE).
