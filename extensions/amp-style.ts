/**
 * amp-pi-style — Amp-inspired look & feel for the pi coding agent. Purely visual.
 *
 * Transcript
 * - User messages: no vertical padding, italic, thin theme-colored `▎` bar on the left.
 * - Assistant messages: no leading blank line, exactly one blank line between blocks.
 * - Thinking: removed while `hideThinkingBlock` is on; ctrl+t restores the full view.
 * - Tool calls: semantic one-line summaries such as `✓ Searched query ▸`,
 *   `✓ Edited path +5 -1 ▸`, and `✗ $ cmd ▸`; ctrl+o keeps full details reachable.
 * - Adjacent command/search/read/edit cards become bounded work summaries. An
 *   invisible marker prevents grouping unrelated transcript text.
 *
 * Editor
 * - Rounded box; border color tracks thinking level and bash mode.
 * - Top border: live cost/model/context/level metadata drops whole low-priority
 *   labels as width tightens, never leaving ambiguous tail fragments.
 * - Bottom border: the single home for animated, semantic work activity and a
 *   middle-elided cwd. Scroll indicators (`↑ N more`) remain intact.
 * - Queued steering messages become an attached, one-line summary rail with an
 *   `Enter to steer` affordance; multiple messages compress without height jitter.
 * - Experimental `AMP_PI_PIN_COMPOSER=1` bottom-aligns the lower frame when the
 *   transcript is shorter than the terminal; unsupported editor layouts fall back.
 * - The stock footer is replaced through `ctx.ui.setFooter`: extension statuses
 *   remain dimmed, except hidden redundant keys such as `cursor`.
 * - The stock `Working...` row is blanked but keeps its fixed height and repaint
 *   timer. Retry and compaction loaders remain visible.
 *
 * Implementation: official APIs where available, guarded prototype patches for
 * the remaining surfaces. Width and truncation use pi-tui's ANSI/grapheme-safe
 * primitives; leading OSC semantic-prompt marks stay at byte zero. Missing or
 * renamed internals fall back safely and produce one diagnostic notice.
 */
import {
	AssistantMessageComponent,
	CustomEditor,
	InteractiveMode,
	ToolExecutionComponent,
	UserMessageComponent,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import * as PiTui from "@earendil-works/pi-tui";

const { Loader, TUI, TruncatedText, truncateToWidth } = PiTui as any;
const visibleWidthSafe = (PiTui as any).visibleWidth as ((text: string) => number) | undefined;
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

// ── constants ────────────────────────────────────────────────────────────────

const BAR = "▎";

/** Bottom-border wave while the agent works (repaints ride the stock loader timer). */
const BORDER_SPIN = ["~", "≈", "≋", "≈"];
/** Running-tool card glyph, Amp's rotating therefore-dots. */
const TOOL_SPIN = ["∴", "∵", "∷", "∵"];

/** Tools whose cards read `Edited/Wrote <path>` and get diff +N -M stats. */
const EDIT_TOOLS = new Set(["edit", "write", "cursor", "apply_patch", "multiedit"]);

/** Collapsed tool-card line, used for grouping. Excludes the running `∴` state. */
const CARD_RE = /^([✓✗]) (\$ |Read |Searched |Edited |Wrote )/;
/** Diff stats at the end of an edit card: `+5 -1 ▸`. */
const CARD_STATS_RE = /\+(\d+) -(\d+) ▸\s*$/;
/** Zero-width markers scope final-frame transforms to rows created by this
 *  extension or by Pi's own queued-message renderer. */
const CARD_MARK = "\x1b]777;amp-pi-style;card\x07";
const STEER_MARK = "\x1b]777;amp-pi-style;steer\x07";
const FOLLOW_UP_MARK = "\x1b]777;amp-pi-style;follow-up\x07";
const QUEUE_HINT_MARK = "\x1b]777;amp-pi-style;queue-hint\x07";
const QUEUE_MARKS = [STEER_MARK, FOLLOW_UP_MARK, QUEUE_HINT_MARK];
/** Marks the active composer boundary for the optional final-frame anchor pass. */
const COMPOSER_MARK = "\x1b]777;amp-pi-style;composer\x07";
const FRAME_MARKS = [CARD_MARK, ...QUEUE_MARKS, COMPOSER_MARK];
/** Experimental because pi-tui is an inline renderer without an official
 *  bottom-aligned layout primitive. Disabled unless explicitly requested. */
const PIN_COMPOSER = /^(?:1|true|yes|on)$/i.test(process.env.AMP_PI_PIN_COMPOSER ?? "");

/** Leading OSC sequences (e.g. OSC 133 semantic-prompt marks) that must stay at
 *  the very start of a line — semantic-prompt terminals (Ghostty, iTerm2) break
 *  the line if anything is printed before them. */
const LEADING_OSC_RE = /^(?:\x1b\][^\x07\x1b]*(?:\x07|\x1b\\))+/;

// ── live session state (fed by extension events, read at render time) ────────

let lastCtx: any = null;
let activeTheme: any = null;
let thinkingLevel: string | null = null;
let workPhase: string | null = null;
let workTokens = 0;
let activeTools = 0;
let framePassReady = false;
let costCache = { entryCount: -1, value: 0 };
let ctxUsageCache = { at: 0, value: null as any };
const failedPatches: string[] = [];

// ── helpers ──────────────────────────────────────────────────────────────────

const stripAnsi = (s: string): string =>
	FRAME_MARKS.reduce((text, marker) => text.replaceAll(marker, ""), s)
		.replace(LEADING_OSC_RE, "")
		.replace(/\x1b\[[0-9;]*m/g, "");

/** Record a failed prototype patch once at load (never per-render). */
function guard(name: string, ok: boolean) {
	if (!ok) failedPatches.push(name);
}

/** Visible terminal columns using pi-tui's ANSI-, grapheme-, emoji-, and CJK-safe primitive. */
function colWidth(s: string): number {
	const clean = FRAME_MARKS.reduce((text, marker) => text.replaceAll(marker, ""), s).replaceAll("\uFEFF", "");
	if (visibleWidthSafe) return visibleWidthSafe(clean);
	return stripAnsi(clean).length;
}

/** Truncate to `max` columns, with or without a visible omission mark. */
const truncCols = (s: string, max: number): string => truncateToWidth(s, Math.max(0, max), "…");
const hardTrim = (s: string, max: number): string => truncateToWidth(s, Math.max(0, max), "");
const tailCols = (s: string, max: number): string => {
	let out = "";
	let width = 0;
	const segments = [...graphemeSegmenter.segment(s)].map(({ segment }) => segment);
	for (let i = segments.length - 1; i >= 0; i--) {
		const next = colWidth(segments[i]);
		if (width + next > max) break;
		out = segments[i] + out;
		width += next;
	}
	return out;
};

/** Apply a semantic theme role. Plain text is the safe pre-context/NO_COLOR fallback. */
function semantic(role: "accent" | "success" | "error" | "dim" | "text" | "borderMuted", text: string): string {
	try {
		const fg = activeTheme?.fg;
		return typeof fg === "function" ? fg.call(activeTheme, role, text) : text;
	} catch {
		return text;
	}
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
	if (max <= 0) return "";
	const home = process.env.HOME;
	const cwd: string = lastCtx?.cwd ?? process.cwd();
	const p = home && cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;
	if (colWidth(p) <= max) return p;
	const seg = p.split("/");
	// Keep the first segment and as many complete trailing segments as fit.
	for (let keep = seg.length - 2; keep >= 1; keep--) {
		const cand = `${seg[0]}/…/${seg.slice(seg.length - keep).join("/")}`;
		if (colWidth(cand) <= max) return cand;
	}
	// Extremely narrow: retain both the path origin and its literal tail.
	const prefix = p.startsWith("~/") ? "~/" : p.startsWith("/") ? "/" : `${seg[0]}/`;
	const tailBudget = Math.max(0, max - colWidth(prefix) - 1);
	if (tailBudget <= 0) return hardTrim(prefix, max);
	return `${prefix}…${tailCols(p, tailBudget)}`;
}

/** Insert `text` after any leading OSC marks so they stay at the line start. */
function afterLeadingOsc(line: string, text: string): string {
	const m = line.match(LEADING_OSC_RE);
	return m ? m[0] + text + line.slice(m[0].length) : text + line;
}

// ── tool-card grouping (line-level pass over the final TUI render) ───────────

type ToolCat = "cmd" | "search" | "read" | "edit" | "other";
type CardCat = Exclude<ToolCat, "other">;

function toolCategory(name: string): ToolCat {
	const n = name.toLowerCase();
	if (["bash", "command", "exec", "run_command", "shell"].includes(n)) return "cmd";
	if (["grep", "find", "glob", "search", "web_search"].includes(n) || n.startsWith("search_") || n.endsWith("_search")) return "search";
	if (["read", "fetch", "fetch_content", "fetch_url", "web_fetch"].includes(n)) return "read";
	if (EDIT_TOOLS.has(n)) return "edit";
	return "other";
}

const oneLine = (text: string): string => text.replace(/[\r\n\t]+/g, " ").replace(/ +/g, " ").trim();
const firstText = (value: any, keys: string[]): string => {
	for (const key of keys) {
		if (typeof value?.[key] === "string") {
			const text = oneLine(value[key]);
			if (text) return text;
		}
	}
	return "";
};

function toolSummary(name: string, args: any): string {
	const cat = toolCategory(name);
	const path = firstText(args, ["path", "file", "filePath", "url"]);
	if (cat === "cmd" && typeof args?.command === "string") return `$ ${oneLine(args.command.split(/\r?\n/)[0])}`;
	if (cat === "search") {
		const query = firstText(args, ["query", "pattern", "search", "term", "glob"]) || path;
		return query ? `Searched ${query}` : "Searched";
	}
	if (cat === "read" && path) return `Read ${path}`;
	if (cat === "edit" && path) return `${name.toLowerCase() === "write" ? "Wrote" : "Edited"} ${path}`;
	if (path) return `${name} ${path}`;
	const description = firstText(args, ["description"]);
	return description ? `${name} ${description.split("\n")[0]}` : name.replace(/[_-]+/g, " ");
}

function cardInfo(line: string | undefined): { icon: string; cat: CardCat; add: number; del: number } | null {
	if (!line?.includes(CARD_MARK)) return null;
	const plain = stripAnsi(line);
	const m = plain.match(CARD_RE);
	if (!m) return null;
	const prefix = m[2];
	const cat: CardCat = prefix.startsWith("$")
		? "cmd"
		: prefix.startsWith("Read")
			? "read"
			: prefix.startsWith("Searched")
				? "search"
				: "edit";
	const s = cat === "edit" ? plain.match(CARD_STATS_RE) : null;
	return { icon: m[1], cat, add: s ? Number(s[1]) : 0, del: s ? Number(s[2]) : 0 };
}

/** Merge runs of adjacent same-category cards (separated only by blank lines):
 *  `✓ Ran N commands[, M failed] ▸`, `✓ Read N files ▸`,
 *  `✓ Edited N files +ΣA -ΣD ▸` (diff stats aggregated, Amp-style). */
function mergeToolCards(lines: string[], width: number): string[] {
	if (width < 16) return lines;
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
				cur.cat === "cmd"
					? `Ran ${run.length} commands`
					: cur.cat === "search"
						? `Ran ${run.length} searches`
						: cur.cat === "read"
							? `Read ${run.length} files`
							: `Edited ${run.length} files`;
			let statsPlain = "";
			if (cur.cat === "edit") {
				const add = run.reduce((n, c) => n + c.add, 0);
				const del = run.reduce((n, c) => n + c.del, 0);
				if (add || del) statsPlain = ` +${add} -${del}`;
			}
			const compactNoun =
				cur.cat === "cmd" ? `Cmd ${run.length}` : cur.cat === "search" ? `Search ${run.length}` : cur.cat === "read" ? `Read ${run.length}` : `Edit ${run.length}`;
			const categoryMark = cur.cat === "cmd" ? "C" : cur.cat === "search" ? "S" : cur.cat === "read" ? "R" : "E";
			const candidates = [
				{ noun, fail: failed ? `, ${failed} failed` : "", stats: statsPlain },
				{ noun, fail: failed ? `, ${failed} failed` : "", stats: "" },
				{ noun: compactNoun, fail: failed ? `, ${failed} failed` : "", stats: "" },
				{ noun: compactNoun, fail: failed ? ` · ${failed} fail` : "", stats: "" },
				{ noun: `${categoryMark}${run.length}`, fail: failed ? ` F${failed}` : "", stats: "" },
			];
			const fits = (part: { noun: string; fail: string; stats: string }) =>
				colWidth(`✗ ${part.noun}${part.fail}${part.stats} ▸`) <= Math.max(1, width - 1);
			const chosen = candidates.find(fits);
			// If even the count-preserving shorthand cannot fit, retain the
			// already bounded individual cards instead of dropping semantics.
			if (!chosen) {
				out.push(lines[i]);
				i++;
				continue;
			}
			const icon = semantic(failed ? "error" : "success", failed ? "✗" : "✓");
			const fail = chosen.fail ? semantic("error", chosen.fail) : "";
			const stats = chosen.stats
				? ` ${semantic("success", chosen.stats.trim().split(" ")[0])} ${semantic("error", chosen.stats.trim().split(" ")[1])}`
				: "";
			out.push(`${icon} ${chosen.noun}${fail}${stats} ${semantic("dim", "▸")}${CARD_MARK}`);
			i = j + 1;
		} else {
			out.push(lines[i]);
			i++;
		}
	}
	return out;
}

/** Replace Pi's marked queued-steering rows with a stable summary rail. The
 *  blank status/widget rows move above it, so the rail sits against the next
 *  visible surface (normally the composer) without changing total height. */
function decoratePendingSteer(lines: string[], width: number): string[] {
	const unmarkFrame = (line: string) => FRAME_MARKS.reduce((text, marker) => text.replaceAll(marker, ""), line);
	const cleanFrameLines = () => lines.map(unmarkFrame);
	if (width < 24) return cleanFrameLines();
	let hint = -1;
	for (let i = lines.length - 1; i >= 0; i--) {
		if (lines[i].includes(QUEUE_HINT_MARK)) {
			hint = i;
			break;
		}
	}
	if (hint < 0) return cleanFrameLines();

	let firstQueued = hint - 1;
	while (firstQueued >= 0 && (lines[firstQueued].includes(STEER_MARK) || lines[firstQueued].includes(FOLLOW_UP_MARK))) firstQueued--;
	firstQueued++;
	const steerRows: number[] = [];
	const followUpRows: number[] = [];
	for (let i = firstQueued; i < hint; i++) {
		if (lines[i].includes(STEER_MARK)) steerRows.push(i);
		else if (lines[i].includes(FOLLOW_UP_MARK)) followUpRows.push(i);
	}
	if (steerRows.length === 0) return cleanFrameLines();

	const messages = steerRows.map((i) => stripAnsi(lines[i]).trim().slice("Steering: ".length).trim());
	const latest = messages[messages.length - 1] ?? "";
	const summary = messages.length > 1 ? `${messages.length} steering · ${latest}` : latest;
	const railWidth = width - 2; // one-column inset on both sides, like the reference
	const fullHint = "Enter to steer";
	const hintWidth = colWidth(fullHint);
	const withHintBudget = railWidth - hintWidth - 5;
	const showHint = withHintBudget >= 8;
	const messageBudget = showHint ? withHintBudget : railWidth - 4;
	const shown = colWidth(summary) > messageBudget ? truncCols(summary, messageBudget) : summary;
	const hintStyled = showHint ? `${semantic("accent", "Enter")}${semantic("dim", " to steer")}` : "";
	const gap = " ".repeat(Math.max(showHint ? 1 : 0, railWidth - 4 - colWidth(shown) - (showHint ? hintWidth : 0)));
	const border = (left: string, rightCorner: string) => ` ${semantic("borderMuted", left + "─".repeat(railWidth - 2) + rightCorner)} `;
	const content = ` ${semantic("borderMuted", "│")} ${semantic("text", shown)}${gap}${hintStyled} ${semantic("borderMuted", "│")} `;

	let start = firstQueued;
	if (start > 0 && stripAnsi(lines[start - 1]).trim() === "") start--;
	let after = hint + 1;
	while (after < lines.length && stripAnsi(lines[after]).trim() === "") after++;
	// When the next visible line is the composer's rounded top border, let that
	// wider edge close the inset rail. Otherwise give the rail its own bottom.
	const attached = after < lines.length && stripAnsi(lines[after]).trimStart().startsWith("╭");
	const rail = attached ? [border("╭", "╮"), content] : [border("╭", "╮"), content, border("╰", "╯")];
	const secondary = followUpRows.length > 0 ? [...followUpRows.map((i) => unmarkFrame(lines[i])), unmarkFrame(lines[hint])] : [];
	const replacedHeight = hint - start + 1 + (after - hint - 1);
	const preservedBlanks = Math.max(0, replacedHeight - secondary.length - rail.length);
	return [...lines.slice(0, start), ...secondary, ...Array(preservedBlanks).fill(""), ...rail, ...lines.slice(after)].map(unmarkFrame);
}

// ── extension entry ──────────────────────────────────────────────────────────

export default function ampStyle(pi: ExtensionAPI) {
	guard("unicodeWidth", typeof visibleWidthSafe === "function");
	wireEvents(pi);
	patchUserMessages();
	patchAssistantMessages();
	patchToolCards();
	patchCardGrouping();
	patchPendingMessages();
	patchChrome();
	patchEditor();
	if (failedPatches.length) {
		const msg = `amp-pi-style: degraded enhancements: ${failedPatches.join(", ")} — safe or stock fallbacks active`;
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

	const activeToolNames = new Map<string, string>();
	on("agent_start", (e, ctx) => {
		track(e, ctx);
		workPhase = "Working";
		workTokens = 0;
		activeTools = 0;
		activeToolNames.clear();
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

	// Detailed tool activity has one stable home in the editor's bottom border:
	// `≈ Exploring 1 search`, `≈ Running 2 commands`, `≈ Editing 1 file`...
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
				return n === 1 ? "Running 1 tool" : `Running ${n} tools`;
		}
	};
	on("tool_execution_start", (event, _ctx) => {
		const id = event?.toolCallId ?? event?.id ?? `t${activeToolNames.size + 1}`;
		activeToolNames.set(String(id), event?.toolName ?? event?.name ?? "tool");
		activeTools = activeToolNames.size;
		workPhase = activityPhrase([...activeToolNames.values()]);
	});
	on("tool_execution_end", (event, _ctx) => {
		const id = event?.toolCallId ?? event?.id;
		if (id != null) activeToolNames.delete(String(id));
		else {
			const first = activeToolNames.keys().next().value;
			if (first !== undefined) activeToolNames.delete(first);
		}
		activeTools = activeToolNames.size;
		workPhase = activeTools === 0 ? "Working" : activityPhrase([...activeToolNames.values()]);
	});
	on("agent_end", (e, ctx) => {
		track(e, ctx);
		workPhase = null;
		workTokens = 0;
		activeTools = 0;
		activeToolNames.clear();
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
			if (width < 3) return origRender.call(this, width);
			// 3 cols narrower: 2 for the bar prefix + 1 slack so lines never hit
			// the exact terminal width (avoids hard-wrap artifacts).
			const lines = origRender.call(this, width - 3);
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
		if (this.expanded || this.hideComponent || width < 8) return origRender.call(this, width);

		const name = String(this.toolName ?? "tool");
		const a = this.args ?? {};
		const text = toolSummary(name, a);

		// Diff stats for edit-type tools. Pi's built-in edit keeps its display diff
		// in result.details.diff; text output is only a success sentence. Fall back
		// to text for compatible custom edit tools that return a unified diff.
		let stats = "";
		let statsPlain = "";
		if (EDIT_TOOLS.has(name.toLowerCase())) {
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
					stats = ` ${semantic("success", `+${add}`)} ${semantic("error", `-${del}`)}`;
					statsPlain = ` +${add} -${del}`;
				}
			} catch {}
		}

		const err = this.result?.isError === true;
		const spinFrame = TOOL_SPIN[Math.floor(Date.now() / 280) % TOOL_SPIN.length];
		const iconPlain = this.isPartial ? spinFrame : err ? "✗" : "✓";
		const icon = semantic(this.isPartial ? "accent" : err ? "error" : "success", iconPlain);
		// Impact statistics yield before the primary action or target is shortened.
		if (statsPlain && colWidth(text) + colWidth(statsPlain) + 4 > width - 1) {
			stats = "";
			statsPlain = "";
		}
		const budget = Math.max(1, width - 5 - colWidth(statsPlain));
		const shownText = colWidth(text) > budget ? truncCols(text, budget) : text;
		const marker = framePassReady ? CARD_MARK : "";
		return ["", `${icon} ${shownText}${stats} ${semantic("dim", "▸")}${marker}`];
	};
}

/** Mark only children owned by Pi's pending-message container before they
 *  enter the final frame. Custom TruncatedText widgets never receive a marker. */
function patchPendingMessages() {
	const modeProto = InteractiveMode?.prototype as any;
	const textProto = TruncatedText?.prototype as any;
	if (!modeProto || !textProto) return guard("pendingMessages", false);

	if (!modeProto.__ampStylePending) {
		const origUpdate = modeProto.updatePendingMessagesDisplay;
		if (typeof origUpdate !== "function") return guard("pendingMessages", false);
		modeProto.__ampStyle = true;
		modeProto.__ampStylePending = true;
		modeProto.updatePendingMessagesDisplay = function (...args: any[]) {
			const result = origUpdate.apply(this, args);
			for (const child of this.pendingMessagesContainer?.children ?? []) {
				if (!(child instanceof TruncatedText)) continue;
				const text = stripAnsi(String(child.text ?? "")).trim();
				child.__ampQueueMarker = text.startsWith("Steering: ")
					? STEER_MARK
					: text.startsWith("Follow-up: ")
						? FOLLOW_UP_MARK
						: /^↳ .+ to edit all queued messages$/.test(text)
							? QUEUE_HINT_MARK
							: "";
			}
			return result;
		};
	}

	if (!textProto.__ampStylePending) {
		const origRender = textProto.render;
		if (typeof origRender !== "function") return guard("pendingMessages", false);
		textProto.__ampStyle = true;
		textProto.__ampStylePending = true;
		textProto.render = function (width: number) {
			const lines: string[] = origRender.call(this, width);
			const marker = framePassReady ? String(this.__ampQueueMarker ?? "") : "";
			return marker && lines.length === 1 ? [lines[0] + marker] : lines;
		};
	}
}

/** Fill the flexible space immediately before the active composer so the
 *  lower frame ends at the terminal bottom. Pi's normal bottom viewport takes
 *  over once content is taller than the terminal. Exactly one marker is
 *  required: dialogs, replaced editors, and incompatible internals stay stock. */
function pinComposer(lines: string[], terminalRows: number): string[] {
	if (!PIN_COMPOSER || !Number.isFinite(terminalRows) || terminalRows <= 0 || lines.length >= terminalRows) {
		return lines;
	}
	const composers: number[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].includes(COMPOSER_MARK)) composers.push(i);
	}
	if (composers.length !== 1) return lines;
	const fill = terminalRows - lines.length;
	return [...lines.slice(0, composers[0]), ...Array(fill).fill(""), ...lines.slice(composers[0])];
}

/** Final TUI pass: merge adjacent tool cards, anchor the optional composer,
 *  and frame queued steering. */
function patchCardGrouping() {
	const proto = TUI?.prototype as any;
	if (!proto) return guard("cardGrouping", false);
	if (proto.__ampStyleFrame2) {
		framePassReady = true;
		return;
	}

	const origRender = proto.render;
	if (typeof origRender !== "function") return guard("cardGrouping", false);
	proto.__ampStyle = true;
	proto.__ampStyleFrame2 = true;
	proto.render = function (width: number) {
		const merged = mergeToolCards(origRender.call(this, width), width);
		const anchored = pinComposer(merged, Number(this.terminal?.rows ?? 0));
		return decoratePendingSteer(anchored, width);
	};
	framePassReady = true;
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
	if (typeof ctx.ui?.setFooter !== "function") {
		try {
			ctx.ui?.notify?.("amp-pi-style: ctx.ui.setFooter unavailable — stock footer kept", "warning");
		} catch {}
		return;
	}
	try {
		ctx.ui.setFooter((_tui: any, theme: any, footerData: any) => {
			activeTheme = theme;
			return {
				invalidate() {},
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
					const fitted = hardTrim(text, width);
					return fitted ? [theme?.fg?.("dim", fitted) ?? fitted] : [];
				} catch {
					return [];
				}
			},
			};
		});
		footerApplied = true;
	} catch {
		try {
			ctx.ui?.notify?.("amp-pi-style: custom footer failed — stock footer kept", "warning");
		} catch {}
	}
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
	const markComposer = (editor: any, lines: string[]): string[] => {
		// Pi assigns onPasteImage only to the mounted main composer (and copies it
		// to supported replacements). Generic CustomEditor instances in overlays
		// render after the final-frame pass, so they must never carry frame marks.
		if (PIN_COMPOSER && typeof editor?.onPasteImage === "function" && lines.length > 0) {
			lines[0] = afterLeadingOsc(lines[0], COMPOSER_MARK);
		}
		return lines;
	};
	proto.render = function (width: number) {
		if (width < 24) return markComposer(this, baseRender.call(this, width));
		const lines: string[] = baseRender.call(this, width - 2);
		if (lines.length < 2) return markComposer(this, lines);

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

		const scrollInfo = (line: string) => stripAnsi(line).match(/[↑↓] \d+ more/)?.[0] ?? "";

		/** Corner + low-volume labels + fill + corner, always exactly `width`
		 *  columns. Right-side metadata yields before the current activity. */
		const makeBorder = (leftCorner: string, rightCorner: string, origLine: string, leftLabel = "", rightLabel = "") => {
			const scroll = scrollInfo(origLine);
			let left = [scroll, leftLabel].filter(Boolean).join(" · ");
			let leftPlain = left ? `─ ${left} ` : "";
			let rightPlain = rightLabel ? ` ${rightLabel} ─` : "";
			const inner = width - 2;

			if (colWidth(leftPlain) + colWidth(rightPlain) > inner - 1) {
				rightLabel = "";
				rightPlain = "";
			}
			if (colWidth(leftPlain) > inner - 1) {
				left = hardTrim(left, Math.max(0, inner - 4));
				leftPlain = left ? `─ ${left} ` : "";
			}

			const fill = Math.max(1, inner - colWidth(leftPlain) - colWidth(rightPlain));
			const leftStyled = left ? bc("─") + ` ${semantic("dim", left)} ` : "";
			const rightStyled = rightLabel ? ` ${semantic("dim", rightLabel)} ${bc("─")}` : "";
			const osc = origLine.match(LEADING_OSC_RE)?.[0] ?? "";
			return osc + bc(leftCorner) + leftStyled + bc("─".repeat(fill)) + rightStyled + bc(rightCorner);
		};

		// Top border: whole labels disappear by priority instead of tail-truncating
		// into ambiguous model or metric fragments at narrow widths.
		const cost = sessionCost();
		const costLabel = cost === null ? "" : `$${cost >= 0.1 ? cost.toFixed(2) : cost.toFixed(3)}`;
		const model = lastCtx?.getModel?.() ?? lastCtx?.model;
		const modelName = String(model?.name ?? model?.id ?? "");
		const modelId = String(model?.id ?? modelName)
			.split("/")
			.pop()!
			.replace(/-20\d{6,8}$/, "");
		const pct = contextPercent() ?? "";
		const level = String(lastCtx?.getThinkingLevel?.() ?? thinkingLevel ?? "");
		const availableTop = Math.max(0, width - 6 - (scrollInfo(lines[0]) ? colWidth(scrollInfo(lines[0])) + 3 : 0));
		const join = (values: string[], separator: string) => values.filter(Boolean).join(separator);
		const topCandidates = [
			join([costLabel, modelName, pct, level], " ─ "),
			join([costLabel, modelName, pct, level], " · "),
			join([modelName, pct, level], " · "),
			join([modelName, level], " · "),
			join([modelId, level], " · "),
			level,
		];
		const topLabel = topCandidates.find((candidate) => candidate && colWidth(candidate) <= availableTop) ?? "";
		lines[0] = makeBorder("╭", "╮", lines[0], "", topLabel);

		// Bottom border: current activity owns the left; cwd uses only the
		// remaining right-side budget and keeps meaningful path endpoints.
		let status = workPhase ?? "";
		if (status && workTokens > 0 && width >= 48) {
			const tok = workTokens >= 1000 ? `${(workTokens / 1000).toFixed(1)}k` : `${workTokens}`;
			status = `${status} ${tok} tok`;
		}
		const frame = BORDER_SPIN[Math.floor(Date.now() / 250) % BORDER_SPIN.length];
		const activity = status ? `${frame} ${status}` : "";
		const leftWidth = activity ? colWidth(activity) + 3 : 0;
		const pathBudget = Math.min(Math.floor(width / 2), Math.max(0, width - 6 - leftWidth));
		const path = pathBudget >= 8 ? displayPath(pathBudget) : "";
		lines[bottom] = makeBorder("╰", "╯", lines[bottom], activity, path);

		for (let i = 1; i < lines.length; i++) {
			if (i === bottom) continue;
			if (i < bottom) lines[i] = afterLeadingOsc(lines[i], bc("│")) + bc("│");
			else lines[i] = afterLeadingOsc(lines[i], "  ");
		}
		return markComposer(this, lines);
	};
}
