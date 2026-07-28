/**
 * amp-pi-style — Amp-inspired look & feel for the pi coding agent. Purely visual.
 *
 * Transcript
 * - User messages: no vertical padding, italic, thin theme-colored `▎` bar on the left.
 * - Assistant messages: no leading blank line — exactly one blank line between blocks.
 * - Thinking: removed from the transcript while `hideThinkingBlock` is on (live status
 *   is in the editor border instead); ctrl+t still restores the full thinking view.
 * - Tool calls: collapsed to Amp-style one-liners — `✓ Edited path +5 -1 ▸`,
 *   `✗ $ cmd ▸`, animated `∴` while running; ctrl+o expands to the full renderer.
 *   Consecutive command/read cards merge: `✗ Ran 15 commands, 2 failed ▸`.
 *   Collapsed cards carry an invisible marker so grouping only merges our cards.
 *
 * Editor
 * - Rounded box; border color still tracks thinking level / bash mode.
 * - Top border right: `$cost ─ model ─ ctx% ─ level` (all live values).
 * - Bottom border: animated `≈ Thinking 13 tok` on the left while working,
 *   abbreviated cwd on the right. Scroll indicators (`↑ N more`) are preserved.
 * - `∴ Running bash · read` widget line above the box while tools execute.
 * - The stock footer is replaced via the official `ctx.ui.setFooter` API:
 *   only extension status lines (`ctx.ui.setStatus`) remain, dimmed, minus a
 *   small hidden-key list (`cursor` — redundant with the border's model) —
 *   path/model/context live in the editor border. The stock `Working...` spinner is
 *   blanked (prototype patch, kept deliberately: its animation timer drives
 *   the border-spinner repaints). Retry/compaction loaders stay visible.
 *
 * Implementation: official extension APIs where pi provides them (footer,
 * widgets); prototype patches applied at load time for the rest. Every patch
 * is guarded — if a future pi version renames these internals, patches degrade
 * to no-ops instead of crashing, and a one-time load notice names the failed
 * patches. Live data (model, thinking level, context, cost) is read through
 * the extension context's stable getters at render time, never cached from
 * event snapshots.
 */
import {
	AssistantMessageComponent,
	CustomEditor,
	ToolExecutionComponent,
	UserMessageComponent,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Loader, TUI, truncateToWidth } from "@earendil-works/pi-tui";

// ── constants ────────────────────────────────────────────────────────────────

const BAR = "▎";
const DIM = "\x1b[2m";
const UNDIM = "\x1b[22m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RESETFG = "\x1b[39m";

/** Bottom-border wave while the agent works (repaints ride the stock loader timer). */
const BORDER_SPIN = ["~", "≈", "≋", "≈"];
/** Running-tool card glyph, Amp's rotating therefore-dots. */
const TOOL_SPIN = ["∴", "∵", "∷", "∵"];

/** Tools whose cards read `Edited/Wrote <path>` and get diff +N -M stats. */
const EDIT_TOOLS = new Set(["edit", "write", "cursor", "apply_patch", "multiedit"]);

/** Collapsed tool-card line, used for grouping. Excludes the running `∴` state. */
const CARD_RE = /^([✓✗]) (\$ |Read |Edited |Wrote )/;
/** Diff stats at the end of an edit card: `+5 -1 ▸`. */
const CARD_STATS_RE = /\+(\d+) -(\d+) ▸\s*$/;
/** Invisible marker appended to our collapsed cards so grouping ignores lookalikes. */
const CARD_MARK = "\u200b";

/** Leading OSC sequences (e.g. OSC 133 semantic-prompt marks) that must stay at
 *  the very start of a line — semantic-prompt terminals (Ghostty, iTerm2) break
 *  the line if anything is printed before them. */
const LEADING_OSC_RE = /^(?:\x1b\][^\x07\x1b]*(?:\x07|\x1b\\))+/;

// ── live session state (fed by extension events, read at render time) ────────

let lastCtx: any = null;
let thinkingLevel: string | null = null;
let workPhase: string | null = null;
let workTokens = 0;
let activeTools = 0;
let costCache = { entryCount: -1, value: 0 };
let ctxUsageCache = { at: 0, value: null as any };
const failedPatches: string[] = [];

// ── helpers ──────────────────────────────────────────────────────────────────

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").replaceAll(CARD_MARK, "");

/** Record a failed prototype patch once at load (never per-render). */
function guard(name: string, ok: boolean) {
	if (!ok) failedPatches.push(name);
}

/** Visible column width, counting CJK as 2 columns. Zero-width marks count 0. */
function colWidth(s: string): number {
	let w = 0;
	for (const ch of s) {
		if (ch === CARD_MARK || ch === "\uFEFF") continue;
		w += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1;
	}
	return w;
}

/** Truncate to `max` columns, appending `…` when cut. */
function truncCols(s: string, max: number): string {
	let w = 0;
	let out = "";
	for (const ch of s) {
		const cw = colWidth(ch);
		if (w + cw > max) return out + "…";
		out += ch;
		w += cw;
	}
	return out;
}

/** Total session cost, summed from persisted assistant usage. */
function sessionCost(): number | null {
	const entries = lastCtx?.sessionManager?.getEntries?.();
	if (!Array.isArray(entries)) return null;
	if (entries.length === costCache.entryCount) return costCache.value;
	let cost = 0;
	for (const e of entries) {
		const m = e?.message;
		if (m?.role !== "assistant" || m.stopReason === "error" || m.stopReason === "aborted") continue;
		cost += m.usage?.cost?.total ?? 0;
	}
	costCache = { entryCount: entries.length, value: cost };
	return cost;
}

/** Context usage as a percent label, refreshed at most once per second. */
function contextPercent(): string | null {
	const now = Date.now();
	if (now - ctxUsageCache.at > 1000) {
		ctxUsageCache = { at: now, value: lastCtx?.getContextUsage?.() ?? null };
	}
	const u = ctxUsageCache.value;
	const model = lastCtx?.getModel?.() ?? lastCtx?.model;
	const tokens = u?.tokens ?? u?.contextTokens;
	const window = u?.contextWindow ?? model?.contextWindow;
	if (!tokens || !window) return null;
	const pct = (tokens / window) * 100;
	return pct >= 10 ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`;
}

/** cwd with $HOME shortened to `~`, middle segments elided to fit `max` columns
 *  (Amp-style: `~/Library/…/PhD/00_thesis`). */
function displayPath(max: number): string {
	const home = process.env.HOME;
	const cwd: string = lastCtx?.cwd ?? process.cwd();
	const p = home && cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;
	if (colWidth(p) <= max) return p;
	const seg = p.split("/");
	// Keep the first segment and as many trailing segments as fit.
	for (let keep = seg.length - 2; keep >= 1; keep--) {
		const cand = `${seg[0]}/…/${seg.slice(seg.length - keep).join("/")}`;
		if (colWidth(cand) <= max) return cand;
	}
	return truncCols(`${seg[0]}/…/${seg[seg.length - 1]}`, max);
}

/** Insert `text` after any leading OSC marks so they stay at the line start. */
function afterLeadingOsc(line: string, text: string): string {
	const m = line.match(LEADING_OSC_RE);
	return m ? m[0] + text + line.slice(m[0].length) : text + line;
}

// ── tool-card grouping (line-level pass over the final TUI render) ───────────

type CardCat = "cmd" | "read" | "edit";

function cardInfo(line: string | undefined): { icon: string; cat: CardCat; add: number; del: number } | null {
	if (!line?.includes(CARD_MARK)) return null;
	const plain = stripAnsi(line);
	const m = plain.match(CARD_RE);
	if (!m) return null;
	const cat: CardCat = m[2].startsWith("$") ? "cmd" : m[2].startsWith("Read") ? "read" : "edit";
	const s = cat === "edit" ? plain.match(CARD_STATS_RE) : null;
	return { icon: m[1], cat, add: s ? Number(s[1]) : 0, del: s ? Number(s[2]) : 0 };
}

/** Merge runs of adjacent same-category cards (separated only by blank lines):
 *  `✓ Ran N commands[, M failed] ▸`, `✓ Read N files ▸`,
 *  `✓ Edited N files +ΣA -ΣD ▸` (diff stats aggregated, Amp-style). */
function mergeToolCards(lines: string[]): string[] {
	const out: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const cur = cardInfo(lines[i]);
		if (!cur) {
			out.push(lines[i]);
			i++;
			continue;
		}
		const run = [cur];
		let j = i;
		while (j + 2 < lines.length && stripAnsi(lines[j + 1]).trim() === "") {
			const next = cardInfo(lines[j + 2]);
			if (next?.cat !== cur.cat) break;
			j += 2;
			run.push(next);
		}
		if (run.length > 1) {
			const failed = run.filter((c) => c.icon === "✗").length;
			const noun =
				cur.cat === "cmd" ? `Ran ${run.length} commands` : cur.cat === "read" ? `Read ${run.length} files` : `Edited ${run.length} files`;
			let stats = "";
			if (cur.cat === "edit") {
				const add = run.reduce((n, c) => n + c.add, 0);
				const del = run.reduce((n, c) => n + c.del, 0);
				if (add || del) stats = ` ${GREEN}+${add}${RESETFG} ${RED}-${del}${RESETFG}`;
			}
			const icon = failed ? `${RED}✗${RESETFG}` : `${GREEN}✓${RESETFG}`;
			const fail = failed ? `, ${RED}${failed} failed${RESETFG}` : "";
			out.push(`${icon} ${noun}${fail}${stats} ${DIM}▸${UNDIM}${CARD_MARK}`);
			i = j + 1;
		} else {
			out.push(lines[i]);
			i++;
		}
	}
	return out;
}

// ── extension entry ──────────────────────────────────────────────────────────

export default function ampStyle(pi: ExtensionAPI) {
	wireEvents(pi);
	patchUserMessages();
	patchAssistantMessages();
	patchToolCards();
	patchCardGrouping();
	patchChrome();
	patchEditor();
	if (failedPatches.length) {
		const msg = `amp-pi-style: degraded patches: ${failedPatches.join(", ")} — stock UI until package is updated`;
		console.error(msg);
		let notified = false;
		const warn = (_event: any, ctx: any) => {
			if (notified) return;
			notified = true;
			try {
				ctx?.ui?.notify?.(msg, "warning");
			} catch {}
		};
		for (const ev of ["session_start", "turn_start", "agent_start"]) {
			try {
				(pi as any).on(ev, warn);
			} catch {}
		}
	}
}

/** Track live context + working status from extension events. */
function wireEvents(pi: ExtensionAPI) {
	const on = (ev: string, fn: (event: any, ctx: any) => void) => {
		try {
			(pi as any).on(ev, fn);
		} catch {}
	};
	const track = (_event: any, ctx: any) => {
		if (ctx) lastCtx = ctx;
		if (ctx?.thinkingLevel) thinkingLevel = ctx.thinkingLevel;
		applyFooter(ctx);
	};
	for (const ev of ["session_start", "turn_start", "turn_end", "model_select"]) on(ev, track);
	on("thinking_level_select", (event, ctx) => {
		track(event, ctx);
		thinkingLevel = event?.level ?? thinkingLevel;
	});

	on("agent_start", (e, ctx) => {
		track(e, ctx);
		workPhase = "Working";
		workTokens = 0;
		activeTools = 0;
	});
	on("message_update", (event, ctx) => {
		track(event, ctx);
		const content = event?.message?.content;
		if (!Array.isArray(content)) return;
		const last = content[content.length - 1];
		workPhase = last?.type === "thinking" ? "Thinking" : last?.type === "toolCall" ? "Tool call" : "Streaming";
		const usageOut = event?.message?.usage?.output;
		if (usageOut > 0) {
			workTokens = usageOut;
		} else {
			let chars = 0;
			for (const c of content) chars += (c?.text?.length ?? 0) + (c?.thinking?.length ?? 0);
			workTokens = Math.round(chars / 4);
		}
	});

	// Amp-style activity line above the editor while tools execute:
	// `∴ Exploring 1 search`, `∴ Running 2 commands`, `∴ Editing 1 file`...
	const activeToolNames = new Map<string, string>();
	const toolCategory = (name: string): string => {
		const n = name.toLowerCase();
		if (n === "bash" || n.includes("command") || n.includes("exec")) return "cmd";
		if (n.includes("grep") || n.includes("find") || n.includes("glob") || n.includes("search")) return "search";
		if (n === "read" || n.includes("fetch")) return "read";
		if (EDIT_TOOLS.has(n)) return "edit";
		return "other";
	};
	const activityPhrase = (names: string[]): string => {
		const n = names.length;
		const cats = new Set(names.map(toolCategory));
		if (cats.size > 1) return `Running ${n} tools`;
		const plural = (word: string) => (n > 1 ? `${n} ${word}s` : `1 ${word}`);
		switch ([...cats][0]) {
			case "cmd":
				return `Running ${plural("command")}`;
			case "search":
				return `Exploring ${plural("search")}`;
			case "read":
				return `Reading ${plural("file")}`;
			case "edit":
				return `Editing ${plural("file")}`;
			default:
				return n === 1 ? `Running ${names[0]}` : `Running ${n} tools`;
		}
	};
	const updateToolWidget = (ctx: any) => {
		try {
			if (!ctx?.hasUI) return;
			const names = [...activeToolNames.values()];
			ctx.ui.setWidget("amp-style-tools", names.length ? [`${DIM}∴ ${activityPhrase(names)}${UNDIM}`] : []);
		} catch {}
	};
	on("tool_execution_start", (event, ctx) => {
		activeTools++;
		workPhase = activeTools > 1 ? `Running ${activeTools} tools` : "Running tools";
		const id = event?.toolCallId ?? event?.id ?? `t${activeTools}`;
		activeToolNames.set(String(id), event?.toolName ?? event?.name ?? "tool");
		updateToolWidget(ctx);
	});
	on("tool_execution_end", (event, ctx) => {
		activeTools = Math.max(0, activeTools - 1);
		if (activeTools === 0) {
			workPhase = "Working";
			activeToolNames.clear();
		} else {
			const id = event?.toolCallId ?? event?.id;
			if (id != null) activeToolNames.delete(String(id));
		}
		updateToolWidget(ctx);
	});
	on("agent_end", (e, ctx) => {
		track(e, ctx);
		workPhase = null;
		workTokens = 0;
		activeTools = 0;
		activeToolNames.clear();
		updateToolWidget(ctx);
		costCache.entryCount = -1;
		ctxUsageCache.at = 0;
	});
}

/** User messages: compact, italic, thin theme-colored left bar. */
function patchUserMessages() {
	const proto = UserMessageComponent?.prototype as any;
	if (!proto) return guard("userMessages", false);
	if (proto.__ampStyle) return;
	proto.__ampStyle = true;

	const origRebuild = proto.rebuild;
	const origRender = proto.render;
	const ok = typeof origRebuild === "function" || typeof origRender === "function";
	guard("userMessages", ok);
	if (!ok) return;

	if (typeof origRebuild === "function") {
		proto.rebuild = function () {
			origRebuild.call(this);
			const box = this.children?.[0];
			if (box && typeof box.paddingY === "number") {
				box.paddingY = 0;
				box.invalidateCache?.();
			}
			const md = box?.children?.[0];
			if (md?.defaultTextStyle) {
				md.defaultTextStyle.italic = true;
				md.invalidate?.();
			}
		};
	}

	if (typeof origRender === "function") {
		proto.render = function (width: number) {
			// 3 cols narrower: 2 for the bar prefix + 1 slack so lines never hit
			// the exact terminal width (avoids hard-wrap artifacts).
			const lines = origRender.call(this, Math.max(20, width - 3));
			const colorFn = this.children?.[0]?.children?.[0]?.defaultTextStyle?.color;
			const bar = (typeof colorFn === "function" ? colorFn(BAR) : BAR) + " ";
			return lines.map((line: string) => afterLeadingOsc(line, bar));
		};
	}
}

/** Assistant messages: no leading blank line; thinking blocks dropped while
 *  hidden (ctrl+t restores them — the unfiltered message is kept). */
function patchAssistantMessages() {
	const proto = AssistantMessageComponent?.prototype as any;
	if (!proto) return guard("assistantMessages", false);
	if (proto.__ampStyle) return;
	proto.__ampStyle = true;

	const origUpdate = proto.updateContent;
	if (typeof origUpdate !== "function") return guard("assistantMessages", false);
	proto.updateContent = function (message: any) {
		let m = message;
		if (this.hideThinkingBlock && Array.isArray(m?.content) && m.content.some((c: any) => c?.type === "thinking")) {
			m = { ...m, content: m.content.filter((c: any) => c?.type !== "thinking") };
		}
		origUpdate.call(this, m);
		this.lastMessage = message;
		const cc = this.contentContainer;
		const first = cc?.children?.[0];
		if (first?.constructor?.name === "Spacer") {
			cc.removeChild(first);
		}
	};
}

/** Tool calls: Amp-style one-line cards when collapsed; ctrl+o expands. */
function patchToolCards() {
	const proto = ToolExecutionComponent?.prototype as any;
	if (!proto) return guard("toolCards", false);
	if (proto.__ampStyle) return;
	proto.__ampStyle = true;

	const origRender = proto.render;
	if (typeof origRender !== "function") return guard("toolCards", false);
	proto.render = function (width: number) {
		if (this.expanded || this.hideComponent) return origRender.call(this, width);

		const name = String(this.toolName ?? "tool");
		const a = this.args ?? {};
		const path =
			typeof a.path === "string" ? a.path : typeof a.file === "string" ? a.file : typeof a.filePath === "string" ? a.filePath : "";
		let text = name;
		if (typeof a.command === "string") text = `$ ${a.command.split("\n")[0]}`;
		else if (name === "read" && path) text = `Read ${path}`;
		else if (EDIT_TOOLS.has(name) && path) text = `${name === "write" ? "Wrote" : "Edited"} ${path}`;
		else if (path) text = `${name} ${path}`;
		else if (typeof a.description === "string") text = `${name} ${a.description.split("\n")[0]}`;

		// Diff stats for edit-type tools. Pi's built-in edit keeps its display diff
		// in result.details.diff; text output is only a success sentence. Fall back
		// to text for compatible custom edit tools that return a unified diff.
		let stats = "";
		let statsPlain = "";
		if (EDIT_TOOLS.has(name)) {
			try {
				const resultDiff = this.result?.details?.diff;
				const out: string = typeof resultDiff === "string" ? resultDiff : (this.getTextOutput?.() ?? "");
				let add = 0;
				let del = 0;
				for (const line of out.split("\n")) {
					if (line.startsWith("+") && !line.startsWith("+++")) add++;
					else if (line.startsWith("-") && !line.startsWith("---")) del++;
				}
				if (add || del) {
					stats = ` ${GREEN}+${add}${RESETFG} ${RED}-${del}${RESETFG}`;
					statsPlain = ` +${add} -${del}`;
				}
			} catch {}
		}

		const err = this.result?.isError === true;
		const spinFrame = TOOL_SPIN[Math.floor(Date.now() / 280) % TOOL_SPIN.length];
		const icon = this.isPartial ? `${GREEN}${spinFrame}${RESETFG}` : err ? `${RED}✗${RESETFG}` : `${GREEN}✓${RESETFG}`;
		const iconPlain = this.isPartial ? spinFrame : err ? "✗" : "✓";
		const budget = Math.max(10, width - 1 - colWidth(`${iconPlain} ${statsPlain} ▸`));
		const shownText = colWidth(text) > budget ? truncCols(text, budget) : text;
		return ["", `${icon} ${shownText}${stats} ${DIM}▸${UNDIM}${CARD_MARK}`];
	};
}

/** Merge adjacent tool cards across component boundaries (TUI-level pass). */
function patchCardGrouping() {
	const proto = TUI?.prototype as any;
	if (!proto) return guard("cardGrouping", false);
	if (proto.__ampStyle) return;
	proto.__ampStyle = true;

	const origRender = proto.render;
	if (typeof origRender !== "function") return guard("cardGrouping", false);
	proto.render = function (width: number) {
		return mergeToolCards(origRender.call(this, width));
	};
}

/** Status keys hidden from the footer. `cursor` (pi-cursor-sdk's
 *  `cursor:local · fast:on`) is redundant — the model already shows in the
 *  editor border. */
const HIDDEN_STATUS_KEYS = new Set(["cursor"]);

/** Replace the stock footer via the official `ctx.ui.setFooter` API: only
 *  extension status lines (`ctx.ui.setStatus`) remain, dimmed, minus
 *  `HIDDEN_STATUS_KEYS` — path/model/context already live in the editor
 *  border. Runs once, on the first event whose context has a UI; degrades to
 *  the stock footer if the API is missing. */
let footerApplied = false;
function applyFooter(ctx: any) {
	if (footerApplied || !ctx?.hasUI) return;
	footerApplied = true;
	if (typeof ctx.ui?.setFooter !== "function") {
		try {
			ctx.ui?.notify?.("amp-pi-style: ctx.ui.setFooter unavailable — stock footer kept", "warning");
		} catch {}
		return;
	}
	ctx.ui.setFooter((_tui: any, _theme: any, footerData: any) => ({
		render(width: number) {
			try {
				const statuses = footerData?.getExtensionStatuses?.();
				if (!statuses?.size) return [];
				const text = [...statuses.entries()]
					.filter(([key]) => !HIDDEN_STATUS_KEYS.has(key))
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([, t]) => String(t).replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim())
					.filter(Boolean)
					.join(" ");
				return text ? [`${DIM}${truncateToWidth(text, width)}${UNDIM}`] : [];
			} catch {
				return [];
			}
		},
	}));
}

/** Hide the stock `Working...` spinner line — its info lives in the editor
 *  border. Retry/compaction loaders stay visible. Kept as a prototype patch on
 *  purpose: `setWorkingVisible(false)` would skip creating the working loader,
 *  and with it the animation timer whose `requestRender` repaints our border
 *  spinner between stream events. */
function patchChrome() {
	const loaderProto = Loader?.prototype as any;
	if (!loaderProto) {
		guard("loader", false);
	} else if (!loaderProto.__ampStyle) {
		loaderProto.__ampStyle = true;
		const origRender = loaderProto.render;
		if (typeof origRender !== "function") {
			guard("loader", false);
		} else {
			loaderProto.render = function (width: number) {
				// Keep the 2-line height of the visible loader — collapsing to zero
				// lines makes the layout flap while working and leaves ghosts.
				if ((this as any).kind === "working") return ["", ""];
				return origRender.call(this, width);
			};
		}
	}
}

/** Editor: Amp-style rounded box with live info in the borders. */
function patchEditor() {
	const proto = CustomEditor?.prototype as any;
	if (!proto) return guard("editor", false);
	if (proto.__ampStyle) return;
	proto.__ampStyle = true;

	const baseRender = proto.render; // inherited from pi-tui Editor
	if (typeof baseRender !== "function") return guard("editor", false);
	proto.render = function (width: number) {
		if (width < 24) return baseRender.call(this, width);
		const lines: string[] = baseRender.call(this, width - 2);
		if (lines.length < 2) return lines;
		const bc = typeof this.borderColor === "function" ? this.borderColor : (s: string) => s;

		// Bottom border: last line that is a pure border (starts with ─).
		// Lines after it (autocomplete) get indented instead of side-bordered.
		let bottom = -1;
		for (let i = lines.length - 1; i > 0; i--) {
			if (stripAnsi(lines[i]).startsWith("─")) {
				bottom = i;
				break;
			}
		}
		if (bottom === -1) bottom = lines.length - 1;

		const scrollInfo = (line: string) => stripAnsi(line).match(/[↑↓] \d+ more/)?.[0] ?? null;

		/** Corner + optional left label + fill + optional right label + corner,
		 *  always exactly `width` columns; the right label yields when tight. */
		const makeBorder = (
			leftCorner: string,
			rightCorner: string,
			origLine: string,
			leftPlain: string,
			leftStyled: string,
			rightPlain: string,
			rightStyled: string,
		) => {
			const scroll = scrollInfo(origLine);
			if (scroll) {
				leftPlain = `─ ${scroll} ${leftPlain}`;
				leftStyled = bc(`─ ${scroll} `) + leftStyled;
			}
			let fill = width - 2 - colWidth(leftPlain) - colWidth(rightPlain);
			if (fill < 1) {
				rightPlain = "";
				rightStyled = "";
				fill = Math.max(1, width - 2 - colWidth(leftPlain));
			}
			return bc(leftCorner) + leftStyled + bc("─".repeat(fill)) + rightStyled + bc(rightCorner);
		};

		// Top border right: `$cost ─ model ─ ctx% ─ level`, all read live.
		const parts: Array<[string, string]> = [];
		const cost = sessionCost();
		if (cost !== null) {
			const label = `$${cost >= 0.1 ? cost.toFixed(2) : cost.toFixed(3)}`;
			parts.push([label, `${DIM}${label}${UNDIM}`]);
		}
		const model = lastCtx?.getModel?.() ?? lastCtx?.model;
		const modelName = model?.name ?? model?.id;
		if (modelName) parts.push([modelName, `${DIM}${modelName}${UNDIM}`]);
		const pct = contextPercent();
		if (pct) parts.push([pct, `${DIM}${pct}${UNDIM}`]);
		const level = lastCtx?.getThinkingLevel?.() ?? thinkingLevel ?? "";
		if (level) parts.push([level, bc(level)]);
		const topPlain = parts.length ? ` ${parts.map(([p]) => p).join(" ─ ")} ─` : "";
		const topStyled = parts.length ? ` ${parts.map(([, s]) => s).join(bc(" ─ "))} ${bc("─")}` : "";
		lines[0] = makeBorder("╭", "╮", lines[0], "", "", topPlain, topStyled);

		// Bottom border: animated `≈ Thinking 13 tok` left, abbreviated cwd right.
		let status = workPhase;
		if (status && workTokens > 0) {
			const tok = workTokens >= 1000 ? `${(workTokens / 1000).toFixed(1)}k` : `${workTokens}`;
			status = `${status} ${tok} tok`;
		}
		const frame = BORDER_SPIN[Math.floor(Date.now() / 250) % BORDER_SPIN.length];
		const botLeftPlain = status ? `─ ${frame} ${status} ` : "";
		const botLeftStyled = status ? bc("─") + ` ${DIM}${frame} ${status}${UNDIM} ` : "";
		const path = displayPath(Math.max(12, Math.floor(width / 2)));
		lines[bottom] = makeBorder(
			"╰",
			"╯",
			lines[bottom],
			botLeftPlain,
			botLeftStyled,
			` ${path} ─`,
			` ${DIM}${path}${UNDIM} ${bc("─")}`,
		);

		for (let i = 1; i < lines.length; i++) {
			if (i === bottom) continue;
			if (i < bottom) lines[i] = bc("│") + lines[i] + bc("│");
			else lines[i] = "  " + lines[i];
		}
		return lines;
	};
}
