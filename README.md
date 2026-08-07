# amp-pi-style

Grok-informed visual styling for the [pi coding agent](https://github.com/earendil-works/pi): a calm engineering transcript with operation-first tools and live state close to the composer. The package and theme names remain unchanged for backward compatibility.

The update draws from [xai-org/grok-build](https://github.com/xai-org/grok-build), adapting only presentation patterns that Pi can represent safely. See [DESIGN_LANGUAGE.md](./DESIGN_LANGUAGE.md) for the detailed Chinese-language design model.

## What you get

**Transcript first**

- Flat, single-column rendering with no chat bubbles and one stable blank line between blocks.
- User prompts use a raised band with a `❯` arrow. Wrapped and explicit continuation lines align beneath the prompt without disturbing OSC semantic-prompt marks.
- Assistant responses remain plain, incrementally rendered Markdown. Pi owns thinking visibility and `ctrl+t`; visible thinking is recommended to match Grok's progressive-disclosure model.
- Completed tools become expandable semantic summaries:

```text
Search terminal unicode width ▸
Read src/config.ts ▸
Edit src/config.ts +5 -1 ▸
✗ $ npm test ▸
```

- Running tools use Grok's Braille activity sequence; completed rows are operation-first, while `✗` remains reserved for failure.
- Adjacent command, search, read, and edit cards compress into bounded work summaries such as `◈ Ran 15 commands · 2 failed ▸` and `◈ Edited 4 files +83 -17 ▸`.
- `ctrl+o` always returns to Pi's full renderer, so compact presentation never removes diagnostic detail.

**Composer as the state home**

```text
╭──────────────────────── model ─ 18% ─ high ─╮
│ next instruction                             │
╰─ ⠋ Editing 2 files… ─────────── ~/repo/app ─╯
```

- The rounded border continues to reflect thinking level and bash mode.
- The top border carries live model, context usage, and thinking level at low visual volume.
- Narrow terminals remove whole metadata labels by priority. They never leave misleading partial percentages or model fragments.
- The bottom border is Pi's compact substitute for Grok's dedicated turn-status row: `Thinking…`, `Responding…`, `Searching 2 patterns…`, `Running 3 commands…`, `Reading 1 file…`, or `Editing 2 files…`.
- Queued steering becomes an attached rounded rail above the composer: the latest instruction stays visible, multiple queued messages compress to a count, and `Enter to steer` keeps the interaction discoverable.
- The cwd keeps its origin and meaningful tail with middle elision, for example `~/Library/…/project/src`.
- Scroll indicators such as `↑ 4 more` and `↓ 2 more` remain intact.
- Experimental pinned-composer mode keeps the lower frame at the terminal bottom while a short transcript grows upward; it defaults on for macOS and remains environment-toggleable.
- Pi's stock `Working...` row becomes visually blank but retains its fixed height and animation timer, preventing layout movement while keeping border animation alive. Retry and compaction notices remain visible.

**Quiet semantic themes**

- `amp-style`: the GrokNight palette adapted to Pi's theme roles—near-black neutrals, purple activity, green success, yellow warning, and pink-red errors.
- `amp-warm`: the same semantic structure with warm orange focus and cream text.
- User prompts use a raised surface; assistant, custom, pending, successful, and failed tool content retain a flat terminal background.
- Color reinforces meaning but does not create it. `◈`, `✗`, action words, counts, and `▸` remain understandable under limited-color or `NO_COLOR` conditions.

## Responsive behavior

The renderer uses Pi TUI's ANSI-, grapheme-, emoji-, and CJK-aware width primitives.

- Compact tool cards reserve one terminal column to avoid hard-wrap artifacts; below 8 columns they use Pi's stock renderer.
- Narrow cards drop diff statistics before shortening the action and target.
- Grouping begins at 16 columns. Narrower views keep the already bounded individual cards instead.
- Grouped failures retain the group marker, action count, failed count, and expansion affordance before less important statistics.
- Composer box lines and the steering rail also keep one slack column so Ghostty/iTerm never auto-wrap a full-width row into the next border.
- Composer metadata removes separators and low-priority labels before sacrificing the current activity.
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

This is experimental because Pi currently exposes no official bottom-aligned layout primitive and its TUI renders inline in the terminal. Starting the mode can push the preceding shell prompt into scrollback. Unsupported or replaced editor layouts safely retain Pi's normal top-flow behavior. Set the variable before starting Pi; changing it requires a restart.

## How it works

The extension prefers Pi's official APIs where they exist. It replaces the footer through `ctx.ui.setFooter`, preserving dimmed extension statuses except intentionally hidden redundant keys such as `cursor`.

Pi does not expose official APIs for every visual surface, so user messages, assistant spacing, tool summaries, card grouping, the working loader, and editor chrome use guarded prototype patches. Every patch checks that its target exists and marks itself for idempotence. Missing or renamed internals produce one diagnostic notice and use safe or stock behavior instead of crashing the agent.

The working loader remains a prototype patch by design. Calling `setWorkingVisible(false)` would remove the timer that repaints the composer-border spinner between stream events.

Live model, thinking, and context values come from the extension context at render time. Collapsed cards carry an invisible marker, so the final transcript pass never merges lookalike assistant text. That same bounded pass recognizes Pi's own queued-steering rows and turns them into the attached rail without changing queue behavior.

When pinned composer is enabled, the editor emits a separate invisible boundary marker. The final-frame pass requires exactly one such marker before padding to the current terminal height; dialogs, custom editors that bypass Pi's `CustomEditor`, and incompatible internals therefore fall back without guessing.

## Deliberate scope

This package is purely visual. Grok's typed/selectable scrollback, queue editing and send-now semantics, turn stop/background controls, elapsed timers, prompting, tool policy, and agent behavior are not reproduced. Pi continues to own command palette, sessions, notifications, model selection, tool execution, thinking, response generation, and queue behavior. The extension adapts only transferable renderer ideas: prompt hierarchy, operation-first summaries, semantic grouping, stable geometry, activity language, color, and graceful degradation.

## License

MIT
