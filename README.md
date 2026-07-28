# amp-pi-style

Amp-inspired look & feel for the [pi coding agent](https://github.com/earendil-works/pi): flat, calm, compact.

See [DESIGN_LANGUAGE.md](./DESIGN_LANGUAGE.md) for a detailed Chinese-language distillation of Amp CLI's visual and interaction design system.

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
- Stock footer path/stats and the `Working...` spinner are folded into the border; extension status lines (`ctx.ui.setStatus`) still show, dimmed (footer replaced via pi's official `setFooter` API). The `cursor` status from pi-cursor-sdk is hidden as redundant — edit `HIDDEN_STATUS_KEYS` to taste. Retry/compaction notices stay.

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

The extension uses pi's official extension APIs where they exist — the footer is replaced via `ctx.ui.setFooter` (keeping extension status lines), the activity line via `setWidget` — and patches pi's exported TUI component prototypes at load time for the rest (user/assistant messages, tool cards, editor, loader, and a line-level pass over the final TUI render for card grouping). Every patch is guarded: if a future pi version renames these internals, the patches degrade to no-ops instead of crashing — the UI reverts to stock and a one-time load notice names the failed patches. The loader stays a prototype patch on purpose: pi's `setWorkingVisible(false)` would also remove the animation timer that repaints the border spinner. Live values (model, thinking level, context, cost) are read through the extension context's stable getters at render time. Collapsed tool cards carry an invisible marker so grouping only merges this package's cards.

## License

MIT
