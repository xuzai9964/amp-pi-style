# amp-pi-style

Amp-inspired look and feel for the [pi coding agent](https://github.com/earendil-works/pi): a calm, compact engineering transcript with live state close to the composer.

See [DESIGN_LANGUAGE.md](./DESIGN_LANGUAGE.md) for the detailed Chinese-language design model behind the package. The implementation follows its central rule: preserve understanding while minimizing attention cost.

## What you get

**Transcript first**

- Flat, single-column rendering with no chat bubbles and one stable blank line between blocks.
- User prompts use italic text and a thin accent-colored `▎` rail. Wrapped lines retain the rail without disturbing OSC semantic-prompt marks.
- Thinking stays out of the transcript when `hideThinkingBlock` is enabled. `ctrl+t` still restores the complete thinking view.
- Completed tools become expandable semantic summaries:

```text
✓ Searched terminal unicode width ▸
✓ Read src/config.ts ▸
✓ Edited src/config.ts +5 -1 ▸
✗ $ npm test ▸
```

- Adjacent command, search, read, and edit cards compress into bounded work summaries such as `✗ Ran 15 commands, 2 failed ▸` and `✓ Edited 4 files +83 -17 ▸`.
- `ctrl+o` always returns to Pi's full renderer, so compact presentation never removes diagnostic detail.

**Composer as the state home**

```text
╭────────────────── $0.03 ─ model ─ 18% ─ high ─╮
│ next instruction                                │
╰─ ≈ Editing 2 files ──────────────── ~/repo/app ─╯
```

- The rounded border continues to reflect thinking level and bash mode.
- The top border carries live cost, model, context usage, and thinking level at low visual volume.
- Narrow terminals remove whole metadata labels by priority. They never leave misleading partial prices, percentages, or model fragments.
- The bottom border is the single home for current activity: `Thinking`, `Streaming`, `Exploring 2 searches`, `Running 3 commands`, `Reading 1 file`, or `Editing 2 files`.
- Queued steering becomes an attached rounded rail above the composer: the latest instruction stays visible, multiple queued messages compress to a count, and `Enter to steer` keeps the interaction discoverable.
- The cwd keeps its origin and meaningful tail with middle elision, for example `~/Library/…/project/src`.
- Scroll indicators such as `↑ 4 more` and `↓ 2 more` remain intact.
- Pi's stock `Working...` row becomes visually blank but retains its fixed height and animation timer, preventing layout movement while keeping border animation alive. Retry and compaction notices remain visible.

**Quiet semantic themes**

- `amp-style`: cool slate neutrals, mint focus, restrained green success, and soft red errors.
- `amp-warm`: near-black neutrals with Amp orange focus and a quieter teal-green success role.
- Both themes use the same semantic token structure and inherit the terminal background for user, assistant, custom, pending, successful, and failed tool content.
- Color reinforces meaning but does not create it. `✓`, `✗`, action words, counts, and `▸` remain understandable under limited-color or `NO_COLOR` conditions.

## Responsive behavior

The renderer uses Pi TUI's ANSI-, grapheme-, emoji-, and CJK-aware width primitives.

- Compact tool cards reserve one terminal column to avoid hard-wrap artifacts; below 8 columns they use Pi's stock renderer.
- Narrow cards drop diff statistics before shortening the action and target.
- Grouping begins at 16 columns. Narrower views keep the already bounded individual cards instead.
- Grouped failures retain the failure symbol, action count, failed count, and expansion affordance before less important statistics.
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
  "hideThinkingBlock": true
}
```

`hideThinkingBlock: true` moves thinking into live composer state. Without it, Pi renders thinking blocks normally.

## Recommended companion settings

A renderer can compress tools and chrome, but it cannot repair verbose model output. For matching transcript density, add guidance like this to `~/.pi/agent/AGENTS.md`:

- use at most one blank line between paragraphs and prefer short prose over lists
- do not announce every tool call or repeat visible tool output
- write final summaries as a concise engineering handoff: what changed, why it is correct, what was verified, and what remains

## How it works

The extension prefers Pi's official APIs where they exist. It replaces the footer through `ctx.ui.setFooter`, preserving dimmed extension statuses except intentionally hidden redundant keys such as `cursor`.

Pi does not expose official APIs for every visual surface, so user messages, assistant spacing, tool summaries, card grouping, the working loader, and editor chrome use guarded prototype patches. Every patch checks that its target exists and marks itself for idempotence. Missing or renamed internals produce one diagnostic notice and use safe or stock behavior instead of crashing the agent.

The working loader remains a prototype patch by design. Calling `setWorkingVisible(false)` would remove the timer that repaints the composer-border spinner between stream events.

Live model, thinking, context, and cost values come from the extension context at render time. Collapsed cards carry an invisible marker, so the final transcript pass never merges lookalike assistant text. That same bounded pass recognizes Pi's own queued-steering rows and turns them into the attached rail without changing queue behavior.

## Deliberate scope

This package is purely visual. It does not replace Pi's command palette, session navigation, sidebar behavior, notifications, model selection, tool execution, or agent behavior. Those host-owned surfaces remain available and consistent with Pi. The package focuses on the transferable parts of the Amp design language that can be applied safely: hierarchy, compression, progressive disclosure, stable geometry, semantic color, and graceful degradation.

## License

MIT
