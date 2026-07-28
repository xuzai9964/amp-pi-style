# amp-pi-style

Amp-inspired look & feel for the [pi coding agent](https://github.com/earendil-works/pi): flat, calm, compact.

## What you get

**Transcript**

- Flat rendering — no message bubbles, exactly one blank line between blocks.
- User messages: italic, accent-colored, with a thin `▎` bar on the left (Amp's prompt echo).
- Thinking hidden from the transcript (live status lives in the editor border); `ctrl+t` restores it.
- Tool calls as one-line cards: `✓ Edited path +5 -1 ▸`, `✗ $ cmd ▸`, animated `∴` while running; `ctrl+o` expands the full output.
- Consecutive cards merge Amp-style: `✗ Ran 15 commands, 2 failed ▸`, `✓ Read 3 files ▸`.

**Editor**

- Rounded box whose border color tracks the thinking level (gray when off → green → yellow → red) and bash mode.
- Top border: `$0.012 ─ grok-4.5 ─ 8.6% ─ medium` — live session cost, model, context usage, thinking level.
- Bottom border: animated `≈ Thinking 13 tok` while the agent works; abbreviated cwd (`~/…/PhD/00_thesis`) on the right.
- `∴ Running bash · read` activity line above the box while tools execute.
- The native footer and stock `Working...` spinner are folded into the border (retry/compaction notices stay).

**Themes**

- `amp-style` — cool slate + mint green accent; backgrounds inherit your terminal color.
- `amp-warm` — near-black + Amp's orange `#E7894C`, from Amp's own palette.

## Install

```bash
pi install git:github.com/xuzai9964/amp-pi-style
```

Then in `~/.pi/agent/settings.json` (or via `/settings` in pi):

```json
{
  "theme": "amp-style",
  "hideThinkingBlock": true
}
```

`hideThinkingBlock: true` is what moves thinking out of the transcript; without it thinking blocks render normally.

## Recommended companion settings

For output *density* (the model's writing habits, which no renderer can fix), add rules like these to `~/.pi/agent/AGENTS.md`:

- at most one blank line between paragraphs; prefer short prose over lists
- don't announce every tool call or echo tool output
- summaries as a concise engineering handoff: what changed, why correct, what was verified, what remains

## How it works / caveats

The extension patches pi's exported TUI component prototypes at load time (user/assistant messages, tool cards, editor, footer, loader, and a line-level pass over the final TUI render for card grouping). Every patch is guarded: if a future pi version renames these internals, the patches degrade to no-ops instead of crashing — the UI just reverts to stock until this package is updated. Live values (model, thinking level, context, cost) are read through the extension context's stable getters at render time.

Known trade-offs:

- Hiding the footer also hides extension status lines (e.g. `cursor:local`).
- Card grouping matches rendered card lines; if another extension renders lines that start with `✓ $ ` it would be grouped too (unlikely in practice).

## License

MIT
