/**
 * amp-pi-style — Grok-informed look & feel for the pi coding agent. Purely visual.
 *
 * Transcript
 * - User messages: terminal-inheriting prompt rows with vertical breathing room and a
 *   `❯` prompt arrow whose continuations stay aligned.
 * - Assistant messages: no leading blank line; thinking gains Grok's subdued
 *   `◆` header and `┃` rail while Pi keeps ctrl+t visibility behavior.
 * - Tool calls: muted operation-first rows led by `◆`, a quiet running dot,
 *   or `✗`; ctrl+o still restores Pi's full diagnostic renderer.
 * - Adjacent command/search/read/edit rows become bounded work summaries. An
 *   invisible marker prevents grouping unrelated transcript text.
 *
 * Live region
 * - Pi's official above-editor widget becomes Grok's dedicated turn-status row;
 *   it owns the only activity indicator (animated Braille thinking-orbs;
 *   `AMP_PI_ORBS=off` restores the legacy spinner) and leaves a stable prompt gap.
 * - Pi's official footer becomes a separate agent-status row: cwd/git at left,
 *   context and extension state at right. It never shares the prompt border.
 * - The rounded prompt uses quiet active/idle borders, a `❯` input prefix, and
 *   only model/mode information in its bottom divider. Scroll indicators remain.
 * - Queued steering messages become a flat diamond summary row with an
 *   `Enter to steer` affordance; multiple messages compress without height jitter.
 * - Experimental pinned-composer layout bottom-aligns the lower frame when the
 *   transcript is short. It defaults on for macOS and `AMP_PI_PIN_COMPOSER`
 *   explicitly toggles it on or off; unsupported editor layouts fall back.
 *  - The stock working indicator is disabled through Pi's official API. The
 *   turn-status widget owns its repaint timer; retry/compaction rows stay stock.
 *
 * Surface
 * - Fullscreen and inline modes inherit the terminal background; the extension
 *   never paints an opaque screen-sized canvas.
 * - The composer, including its borders and input rows, also inherits the
 *   terminal background. Only Pi-owned semantic surfaces such as selection,
 *   overlays, and diffs may apply a background.
 *
 * Implementation: official APIs where available, guarded prototype patches for
 * the remaining surfaces. Event contexts are reduced to plain render snapshots
 * and cleared on session shutdown; no timer-driven renderer retains guarded Pi
 * context getters. Width and truncation use pi-tui's ANSI/grapheme-safe primitives;
 * leading OSC semantic-prompt marks stay at byte zero. Missing or renamed
 * internals fall back safely and produce one diagnostic notice.
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
import { liveStatusLayout, orbColumns, orbMode, phaseToOrbState, renderOrbGlyph } from "./orbs/render";

const { HStack, TUI, TuiMainScreen, TuiAltScreen, TruncatedText, truncateToWidth } = PiTui as any;
const visibleWidthSafe = (PiTui as any).visibleWidth as ((text: string) => number) | undefined;
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

// ── constants ────────────────────────────────────────────────────────────────

/** Shared fullscreen gutter. It is applied once at the layout root so every
 *  transcript and dock surface keeps the same baseline and wrap width. */
const SCREEN_GUTTER = 2;

/** Legacy Braille spinner when `AMP_PI_ORBS=off`. */
const ACTIVITY_SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"];

/** Soft accent tint for Braille orbs (matches theme `vars.accent`). */
const ORB_ACCENT_BY_THEME: Record<string, [number, number, number]> = {
	"amp-style": [0xbb, 0x9a, 0xf7],
	"amp-warm": [0xe7, 0x89, 0x4c],
};

/** Tools whose cards read `Edit/Write <path>` and get diff +N -M stats. */
const EDIT_TOOLS = new Set(["edit", "write", "cursor", "apply_patch", "multiedit"]);

/** Collapsed completed tool-card line, used for grouping. Running rows use a
 *  static dot and deliberately do not match. */
const CARD_RE = /^(◆|✗) (Run |Read |Search |Edit |Write )/;
/** Diff stats at the end of an edit card: `+5 -1`. */
const CARD_STATS_RE = /\+(\d+) -(\d+)\s*$/;
/** Zero-width markers scope final-frame transforms to rows created by this
 *  extension or by Pi's own queued-message renderer. */
const CARD_MARK = "\x1b]777;amp-pi-style;card\x07";
const STEER_MARK = "\x1b]777;amp-pi-style;steer\x07";
const FOLLOW_UP_MARK = "\x1b]777;amp-pi-style;follow-up\x07";
const QUEUE_HINT_MARK = "\x1b]777;amp-pi-style;queue-hint\x07";
const QUEUE_MARKS = [STEER_MARK, FOLLOW_UP_MARK, QUEUE_HINT_MARK];
/** Marks the first live-region row and the composer fallback for the optional
 *  final-frame anchor pass. */
const LIVE_MARK = "\x1b]777;amp-pi-style;live\x07";
const COMPOSER_MARK = "\x1b]777;amp-pi-style;composer\x07";
const FRAME_MARKS = [CARD_MARK, ...QUEUE_MARKS, LIVE_MARK, COMPOSER_MARK];
/** Experimental because pi-tui is an inline renderer without an official
 *  bottom-aligned layout primitive. macOS defaults on; the environment variable
 *  remains an explicit cross-platform override. */
const PIN_COMPOSER_ENV = process.env.AMP_PI_PIN_COMPOSER?.trim();
const PIN_COMPOSER = PIN_COMPOSER_ENV
	? /^(?:1|true|yes|on)$/i.test(PIN_COMPOSER_ENV)
	: process.platform === "darwin";

/** Leading OSC sequences (e.g. OSC 133 semantic-prompt marks) that must stay at
 *  the very start of a line — semantic-prompt terminals (Ghostty, iTerm2) break
 *  the line if anything is printed before them. */
const LEADING_OSC_RE = /^(?:\x1b\][^\x07\x1b]*(?:\x07|\x1b\\))+/;

// ── live session state (snapshotted from extension events) ──────────────────

type SessionSnapshot = {
	modelName: string;
	modelId: string;
	contextTokens: number | null;
	contextWindow: number | null;
	cwd: string;
	thinkingLevel: string | null;
};

type LiveState = {
	activeTheme: any;
	session: SessionSnapshot | null;
	workPhase: string | null;
	framePassReady: boolean;
};

/** Prototype patches survive Pi's extension reload, while module scope does not.
 *  Keep their render-only data in a reload-stable slot, and never retain an
 *  ExtensionContext whose guarded getters become stale on session replacement. */
const LIVE_STATE_KEY = Symbol.for("amp-pi-style.live-state.v1");
const stateHost = globalThis as any;
const liveState: LiveState = (stateHost[LIVE_STATE_KEY] ??= {
	activeTheme: null,
	session: null,
	workPhase: null,
	framePassReady: false,
});

let activeTools = 0;
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
function semantic(
	role: "accent" | "success" | "error" | "warning" | "muted" | "dim" | "text" | "border" | "borderMuted" | "toolTitle" | "toolOutput",
	text: string,
): string {
	try {
		const fg = liveState.activeTheme?.fg;
		return typeof fg === "function" ? fg.call(liveState.activeTheme, role, text) : text;
	} catch {
		return text;
	}
}

/** Bold text through the active Pi theme, with a plain fallback. */
function strong(text: string): string {
	try {
		const bold = liveState.activeTheme?.bold;
		return typeof bold === "function" ? bold.call(liveState.activeTheme, text) : text;
	} catch {
		return text;
	}
}

/** Context usage as a percent label from the latest lifecycle-safe snapshot. */
function contextPercent(): string | null {
	const tokens = liveState.session?.contextTokens;
	const window = liveState.session?.contextWindow;
	if (!tokens || !window) return null;
	const pct = (tokens / window) * 100;
	return pct >= 10 ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`;
}

/** cwd with $HOME shortened to `~`, middle segments elided to fit `max` columns. */
function displayPath(max: number): string {
	if (max <= 0) return "";
	const home = process.env.HOME;
	const cwd = liveState.session?.cwd ?? process.cwd();
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

/** Left/right status layout that drops whole right-side items before it trims
 *  the identity-bearing left side. */
function statusLine(left: string, rightItems: string[], width: number): string {
	if (width <= 0) return "";
	const items = rightItems.filter(Boolean);
	while (items.length > 0) {
		const right = items.join(` ${semantic("dim", "│")} `);
		const gap = width - colWidth(left) - colWidth(right);
		if (gap >= 1) return `${left}${" ".repeat(gap)}${right}`;
		items.shift();
	}
	return hardTrim(left, width);
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
	if (cat === "cmd" && typeof args?.command === "string") return `Run ${oneLine(args.command.split(/\r?\n/)[0])}`;
	if (cat === "search") {
		const query = firstText(args, ["query", "pattern", "search", "term", "glob"]) || path;
		return query ? `Search ${query}` : "Search";
	}
	if (cat === "read" && path) return `Read ${path}`;
	if (cat === "edit" && path) return `${name.toLowerCase() === "write" ? "Write" : "Edit"} ${path}`;
	if (path) return `${name} ${path}`;
	const description = firstText(args, ["description"]);
	return description ? `${name} ${description.split("\n")[0]}` : name.replace(/[_-]+/g, " ");
}

function cardInfo(line: string | undefined): { failed: boolean; cat: CardCat; add: number; del: number } | null {
	if (!line?.includes(CARD_MARK)) return null;
	const plain = stripAnsi(line);
	const m = plain.match(CARD_RE);
	if (!m) return null;
	const prefix = m[2];
	const cat: CardCat = prefix.startsWith("Run")
		? "cmd"
		: prefix.startsWith("Read")
			? "read"
			: prefix.startsWith("Search")
				? "search"
				: "edit";
	const s = cat === "edit" ? plain.match(CARD_STATS_RE) : null;
	return { failed: m[1] === "✗", cat, add: s ? Number(s[1]) : 0, del: s ? Number(s[2]) : 0 };
}

/** Merge runs of adjacent same-category cards (separated only by blank lines):
 *  `◆ Ran N commands[, M failed]`, `◆ Read N files`,
 *  `◆ Edited N files +ΣA -ΣD` (diff stats aggregated). */
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
			const failed = run.filter((c) => c.failed).length;
			const noun =
				cur.cat === "cmd"
					? `Ran ${run.length} commands`
					: cur.cat === "search"
						? `Searched ${run.length} patterns`
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
				{ noun, fail: failed ? ` · ${failed} failed` : "", stats: statsPlain },
				{ noun, fail: failed ? ` · ${failed} failed` : "", stats: "" },
				{ noun: compactNoun, fail: failed ? ` · ${failed} failed` : "", stats: "" },
				{ noun: compactNoun, fail: failed ? ` · ${failed} fail` : "", stats: "" },
				{ noun: `${categoryMark}${run.length}`, fail: failed ? ` F${failed}` : "", stats: "" },
			];
			const fits = (part: { noun: string; fail: string; stats: string }) =>
				colWidth(`◆ ${part.noun}${part.fail}${part.stats}`) <= Math.max(1, width - 1);
			const chosen = candidates.find(fits);
			// If even the count-preserving shorthand cannot fit, retain the
			// already bounded individual cards instead of dropping semantics.
			if (!chosen) {
				out.push(lines[i]);
				i++;
				continue;
			}
			const icon = semantic("dim", "◆");
			const fail = chosen.fail ? semantic("error", chosen.fail) : "";
			const stats = chosen.stats
				? ` ${semantic("success", chosen.stats.trim().split(" ")[0])} ${semantic("error", chosen.stats.trim().split(" ")[1])}`
				: "";
			out.push(`${icon} ${semantic("toolOutput", chosen.noun)}${fail}${stats}${CARD_MARK}`);
			i = j + 1;
		} else {
			out.push(lines[i]);
			i++;
		}
	}
	return out;
}

/** Replace Pi's marked queued-steering rows with a stable flat diamond summary
 *  row. The blank status/widget rows move above it, so the row sits against the
 *  next visible surface (normally the composer) without changing total height. */
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
	// Flat diamond summary row, one column short of the terminal width (same
	// hard-wrap guard as the composer). The `◆` matches the tool rows.
	const rowWidth = Math.max(8, width - 1);
	const fullHint = "Enter to steer";
	const hintWidth = colWidth(fullHint);
	const withHintBudget = rowWidth - hintWidth - 5;
	const showHint = withHintBudget >= 8;
	const messageBudget = showHint ? withHintBudget : rowWidth - 4;
	const shown = colWidth(summary) > messageBudget ? truncCols(summary, messageBudget) : summary;
	const hintStyled = showHint ? `${semantic("accent", "Enter")}${semantic("dim", " to steer")}` : "";
	const gap = " ".repeat(Math.max(showHint ? 1 : 0, rowWidth - 2 - colWidth(shown) - (showHint ? hintWidth : 0)));
	const rail = [` ${semantic("dim", "◆")} ${semantic("text", shown)}${gap}${hintStyled}`];

	let start = firstQueued;
	if (start > 0 && stripAnsi(lines[start - 1]).trim() === "") start--;
	let after = hint + 1;
	while (after < lines.length && stripAnsi(lines[after]).trim() === "") after++;
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

/** Snapshot render data while the event context is active. Pi deliberately
 *  invalidates that context after `session_shutdown`, so renderers must never
 *  retain it across a session replacement or extension reload. */
function wireEvents(pi: ExtensionAPI) {
	const on = (ev: string, fn: (event: any, ctx: any) => void) => {
		try {
			(pi as any).on(ev, fn);
		} catch {}
	};
	const track = (_event: any, ctx: any) => {
		if (!ctx) return;
		try {
			const model = ctx.model;
			const usage = ctx.getContextUsage?.();
			const modelName = String(model?.name ?? model?.id ?? "");
			liveState.session = {
				modelName,
				modelId: String(model?.id ?? modelName)
					.split("/")
					.pop()!
					.replace(/-20\d{6,8}$/, ""),
				contextTokens: usage?.tokens ?? usage?.contextTokens ?? null,
				contextWindow: usage?.contextWindow ?? model?.contextWindow ?? null,
				cwd: ctx.cwd,
				thinkingLevel: ctx.thinkingLevel ?? null,
			};
			applyLiveRegion(ctx);
			applyFooter(ctx);
		} catch {
			// Event contexts should be active, but a lifecycle race must degrade to
			// the last complete snapshot rather than take down Pi's render loop.
		}
	};
	for (const ev of ["session_start", "turn_start", "turn_end", "model_select"]) on(ev, track);
	on("thinking_level_select", (event, ctx) => {
		track(event, ctx);
		if (liveState.session && event?.level) liveState.session.thinkingLevel = event.level;
	});

	const activeToolNames = new Map<string, string>();
	on("agent_start", (e, ctx) => {
		track(e, ctx);
		liveState.workPhase = "Thinking…";
		activeTools = 0;
		activeToolNames.clear();
	});
	on("message_update", (event, ctx) => {
		track(event, ctx);
		const content = event?.message?.content;
		if (!Array.isArray(content)) return;
		const last = content[content.length - 1];
		liveState.workPhase = last?.type === "thinking" ? "Thinking…" : last?.type === "toolCall" ? "Working…" : "Responding…";
	});

	// Detailed tool activity has one stable home in the turn-status widget:
	// `⠋ Searching 1 pattern…`, `⠋ Running 2 commands…`, `⠋ Editing 1 file…`.
	const activityPhrase = (names: string[]): string => {
		const n = names.length;
		const cats = new Set(names.map(toolCategory));
		if (cats.size > 1) return `Running ${n} tools…`;
		const plural = (word: string) => (n > 1 ? `${n} ${word}s` : `1 ${word}`);
		switch ([...cats][0]) {
			case "cmd":
				return `Running ${plural("command")}…`;
			case "search":
				return `Searching ${plural("pattern")}…`;
			case "read":
				return `Reading ${plural("file")}…`;
			case "edit":
				return `Editing ${plural("file")}…`;
			default:
				return n === 1 ? "Running 1 tool…" : `Running ${n} tools…`;
		}
	};
	on("tool_execution_start", (event, _ctx) => {
		const id = event?.toolCallId ?? event?.id ?? `t${activeToolNames.size + 1}`;
		activeToolNames.set(String(id), event?.toolName ?? event?.name ?? "tool");
		activeTools = activeToolNames.size;
		liveState.workPhase = activityPhrase([...activeToolNames.values()]);
	});
	on("tool_execution_end", (event, _ctx) => {
		const id = event?.toolCallId ?? event?.id;
		if (id != null) activeToolNames.delete(String(id));
		else {
			const first = activeToolNames.keys().next().value;
			if (first !== undefined) activeToolNames.delete(first);
		}
		activeTools = activeToolNames.size;
		liveState.workPhase = activeTools === 0 ? "Thinking…" : activityPhrase([...activeToolNames.values()]);
	});
	on("agent_end", (e, ctx) => {
		track(e, ctx);
		liveState.workPhase = null;
		activeTools = 0;
		activeToolNames.clear();
	});
	on("session_shutdown", () => {
		liveState.session = null;
		liveState.workPhase = null;
		liveState.activeTheme = null;
		activeTools = 0;
		activeToolNames.clear();
		liveRegionApplied = false;
		footerApplied = false;
	});
}

/** User messages: flat prompt row with Grok's vertical rhythm and arrow. */
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
			const box = this.contentBox ?? this.children?.[0];
			if (box && typeof box.paddingY === "number") {
				box.paddingY = 1;
				box.invalidateCache?.();
			}
			const md = box?.children?.[0];
			if (md?.defaultTextStyle) {
				md.defaultTextStyle.italic = false;
				md.invalidate?.();
			}
		};
	}

	if (typeof origRender === "function") {
		proto.render = function (width: number) {
			if (width < 4) return origRender.call(this, width);
			const box = this.contentBox ?? this.children?.[0];
			if (box && typeof box.paddingY === "number" && box.paddingY !== 1) {
				box.paddingY = 1;
				box.invalidateCache?.();
			}
			const md = box?.children?.[0];
			if (md?.defaultTextStyle && md.defaultTextStyle.italic !== false) {
				md.defaultTextStyle.italic = false;
				md.invalidate?.();
			}
			// The box keeps its one-column left padding. Prefix one external
			// column and reserve one right-side slack column to avoid hard wraps.
			const lines = origRender.call(this, width - 2);
			const bgFn = box?.bgFn;
			const paint = (text: string) => (typeof bgFn === "function" ? bgFn(text) : text);
			const arrow = paint(semantic("toolTitle", "❯"));
			const indent = paint(" ");
			const firstContent = Math.max(
				0,
				lines.findIndex((line: string) => stripAnsi(line).trim().length > 0),
			);
			return lines.map((line: string, index: number) => afterLeadingOsc(line, index === firstContent ? arrow : indent));
		};
	}
}

/** Assistant messages: no leading blank line. Thinking keeps Pi's reversible
 *  visibility behavior, but renders as Grok's quiet header + accent rail. */
function patchAssistantMessages() {
	const proto = AssistantMessageComponent?.prototype as any;
	if (!proto) return guard("assistantMessages", false);
	if (proto.__ampStyle) return;
	proto.__ampStyle = true;

	const origUpdate = proto.updateContent;
	if (typeof origUpdate !== "function") return guard("assistantMessages", false);
	proto.updateContent = function (message: any, ...rest: any[]) {
		origUpdate.call(this, message, ...rest);
		const cc = this.contentContainer;
		const first = cc?.children?.[0];
		if (first?.constructor?.name === "Spacer") {
			cc.removeChild(first);
		}

		const lastVisible = [...(message?.content ?? [])]
			.reverse()
			.find((content: any) => content?.type === "toolCall" || (content?.type === "text" && content.text?.trim()) || (content?.type === "thinking" && content.thinking?.trim()));
		const thinkingRunning = Boolean(this.isStreaming && lastVisible?.type === "thinking");
		for (const child of cc?.children ?? []) {
			const hiddenLabel = String(this.hiddenThinkingLabel ?? "Thinking...");
			const isThinking = child?.defaultTextStyle?.italic === true || stripAnsi(String(child?.text ?? "")).trim() === hiddenLabel;
			if (!isThinking || child.__ampThinking) continue;
			const origRender = child.render;
			if (typeof origRender !== "function") continue;
			child.__ampThinking = true;
			child.render = function (width: number) {
				if (width < 6) return origRender.call(this, width);
				const body: string[] = origRender.call(this, Math.max(1, width - 3));
				const label = this.__ampThinkingRunning ? "Thinking…" : "Thought";
				const header = hardTrim(`${semantic("accent", "◆")} ${strong(semantic("muted", label))}`, width - 1);
				if (stripAnsi(String(this.text ?? "")).trim() === String(this.__ampHiddenThinkingLabel ?? "")) return [header];
				const rail = semantic("dim", "┃");
				return [header, ...body.map((line) => afterLeadingOsc(line, `${rail} `))];
			};
			child.__ampThinkingRunning = thinkingRunning;
			child.__ampHiddenThinkingLabel = String(this.hiddenThinkingLabel ?? "Thinking...");
		}
	};
}

/** Tool calls: Grok's diamond activity rail when collapsed; ctrl+o expands. */
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
		const text = toolSummary(name, this.args ?? {});

		// Pi's edit tool stores its display diff in result.details.diff. Compatible
		// custom tools may instead return a unified diff as text.
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

		const running = this.isPartial === true;
		const failed = this.result?.isError === true;
		const iconPlain = running ? "·" : failed ? "✗" : "◆";
		const icon = semantic(running ? "accent" : failed ? "error" : "toolOutput", iconPlain);
		const chromeWidth = colWidth(iconPlain) + 1;
		if (statsPlain && colWidth(text) + colWidth(statsPlain) + chromeWidth > width - 1) {
			stats = "";
			statsPlain = "";
		}
		const budget = Math.max(1, width - chromeWidth - colWidth(statsPlain) - 1);
		const shownText = colWidth(text) > budget ? truncCols(text, budget) : text;
		const split = shownText.indexOf(" ");
		const verb = split < 0 ? shownText : shownText.slice(0, split);
		const detail = split < 0 ? "" : shownText.slice(split);
		const textRole = running ? "text" : "toolOutput";
		const styledText = strong(semantic(textRole, verb)) + semantic(textRole, detail);
		const marker = !running && liveState.framePassReady ? CARD_MARK : "";
		return ["", `${icon} ${styledText}${stats}${marker}`];
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
			const marker = liveState.framePassReady ? String(this.__ampQueueMarker ?? "") : "";
			return marker && lines.length === 1 ? [lines[0] + marker] : lines;
		};
	}
}

/** Fill the flexible space before Grok's complete live region so status,
 *  prompt, and footer stay together at the terminal bottom. Pi's normal bottom
 *  viewport takes over once content is taller than the terminal. */
function pinComposer(lines: string[], terminalRows: number): string[] {
	if (!PIN_COMPOSER || !Number.isFinite(terminalRows) || terminalRows <= 0 || lines.length >= terminalRows) {
		return lines;
	}
	const liveRows: number[] = [];
	const composers: number[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].includes(LIVE_MARK)) liveRows.push(i);
		if (lines[i].includes(COMPOSER_MARK)) composers.push(i);
	}
	const anchors = liveRows.length === 1 ? liveRows : composers;
	if (anchors.length !== 1) return lines;
	const fill = terminalRows - lines.length;
	return [...lines.slice(0, anchors[0]), ...Array(fill).fill(""), ...lines.slice(anchors[0])];
}

/** Wrap the fullscreen root once with symmetric fixed gutters. Applying this
 *  at the layout level gives every child the same narrower wrap width and keeps
 *  selection, scrolling, overlays, transcript, and dock geometry coherent. */
function applyFullscreenGutter(tui: any): boolean {
	if (tui?.mode !== "fullscreen") return true;
	const root = tui.layoutRoot;
	if (root?.__ampStyleGutter) return true;
	if (typeof HStack !== "function" || !root || typeof tui.setLayoutRoot !== "function") return false;
	const blank = () => ({ render: () => [""], invalidate() {} });
	const showGutter = ({ width }: { width: number }) => width >= 12;
	const wrapped = new HStack([
		{ component: blank(), basis: SCREEN_GUTTER, grow: 0, shrink: 0, minSize: SCREEN_GUTTER, visible: showGutter },
		{ component: root, basis: 0, grow: 1, shrink: 1, minSize: 1 },
		{ component: blank(), basis: SCREEN_GUTTER, grow: 0, shrink: 0, minSize: SCREEN_GUTTER, visible: showGutter },
	]);
	wrapped.__ampStyleGutter = true;
	tui.setLayoutRoot(wrapped);
	return true;
}

/** Final TUI pass: merge adjacent tool cards, anchor the optional composer,
 *  and frame queued steering. */
function patchCardGrouping() {
	const modeProto = InteractiveMode?.prototype as any;
	if (TuiAltScreen && modeProto && !modeProto.__ampStyleFullscreenFrame) {
		const origMount = modeProto.mountInteractiveTui;
		if (typeof origMount === "function") {
			modeProto.__ampStyleFullscreenFrame = true;
			modeProto.mountInteractiveTui = function (tui: any, components: any[]) {
				const owner = this;
				const document = this.documentContainer;
				if (document && !document.__ampStyleFrame) {
					const origDocumentRender = document.render;
					if (typeof origDocumentRender === "function") {
						document.__ampStyleFrame = true;
						document.render = function (width: number) {
							return mergeToolCards(origDocumentRender.call(this, width), width).map((line) =>
								FRAME_MARKS.reduce((text, marker) => text.replaceAll(marker, ""), line),
							);
						};
					}
				}
				const pending = this.pendingMessagesContainer;
				if (pending && !pending.__ampStyleFrame) {
					const origPendingRender = pending.render;
					if (typeof origPendingRender === "function") {
						pending.__ampStyleFrame = true;
						pending.render = function (width: number) {
							const lines = origPendingRender.call(this, width);
							return owner.renderer?.mode === "fullscreen" ? decoratePendingSteer(lines, width) : lines;
						};
					}
				}
				const result = origMount.call(this, tui, components);
				applyFullscreenGutter(tui);
				return result;
			};
		} else {
			guard("fullscreenFrame", false);
		}
	}

	// Pi <=0.74 exported one TUI class. Current Pi exports separate main- and
	// alternate-screen implementations. Fullscreen already bottom-aligns its
	// dock; only main-screen renderers need the final pin/queue pass.
	const constructors = [...new Set([TUI, TuiMainScreen].filter((ctor) => typeof ctor === "function"))];
	let patched = false;
	for (const ctor of constructors) {
		const proto = ctor.prototype as any;
		if (proto.__ampStyleFrame2) {
			patched = true;
			continue;
		}
		const origRender = proto.render;
		if (typeof origRender !== "function") continue;
		proto.__ampStyle = true;
		proto.__ampStyleFrame2 = true;
		proto.render = function (width: number) {
			const merged = mergeToolCards(origRender.call(this, width), width);
			const anchored = pinComposer(merged, Number(this.terminal?.rows ?? 0));
			return decoratePendingSteer(anchored, width);
		};
		patched = true;
	}
	guard("cardGrouping", patched);
	guard("fullscreenGutter", typeof HStack === "function");
	liveState.framePassReady = patched;
}

/** Status keys hidden from the footer. `cursor` (pi-cursor-sdk's
 *  `cursor:local · fast:on`) is redundant — the model already shows in the
 *  editor border. */
const HIDDEN_STATUS_KEYS = new Set(["cursor"]);

let liveRegionApplied = false;
/** Install Grok's dedicated turn-status row as Pi's official above-editor
 *  widget. It owns the only activity indicator (thinking-orbs by default) and
 *  its repaint timer, and leaves a stable prompt gap. The stock working
 *  indicator is disabled through Pi's official API (retry/compaction rows stay
 *  stock). Runs once per session; the session_shutdown handler resets it so
 *  the widget reinstalls for the next session. */
function applyLiveRegion(ctx: any) {
	if (liveRegionApplied || !ctx?.hasUI) return;
	if (typeof ctx.ui?.setWidget !== "function" || typeof ctx.ui?.setWorkingVisible !== "function") {
		try {
			ctx.ui?.notify?.("amp-pi-style: setWidget/setWorkingVisible unavailable — stock working indicator kept", "warning");
		} catch {}
		return;
	}
	liveRegionApplied = true;
	try {
		ctx.ui.setWorkingVisible(false);
		ctx.ui.setWorkingIndicator?.({ frames: [] });
		ctx.ui.setWidget(
			"amp-style-live",
			(tui: any, theme: any) => {
				liveState.activeTheme = theme;
				let timer: ReturnType<typeof setInterval> | null = null;
				const tickMs = orbMode() === "off" ? 135 : 80;
				const stopTimer = () => {
					if (timer) {
						clearInterval(timer);
						timer = null;
					}
				};
				return {
					invalidate() {
						liveState.activeTheme = theme;
					},
					render(width: number) {
						const phase = liveState.workPhase;
						// The pin pass only runs on main-screen TUIs; fullscreen
						// bottom-aligns its own dock, so the anchor mark would leak.
						const mark = tui?.mode === "fullscreen" ? "" : LIVE_MARK;
						if (phase && !timer) {
							timer = setInterval(() => {
								try {
									tui?.requestRender?.();
								} catch {}
							}, tickMs);
						} else if (!phase && timer) {
							stopTimer();
						}
						if (!phase) {
							// Stable 1-row prompt gap so the editor never jumps, without
							// consuming the terminal's final column at transitional widths.
							return [`${" ".repeat(liveStatusLayout(width, 0).leadingColumns)}${mark}`];
						}
						if (orbMode() === "off") {
							const frame = ACTIVITY_SPIN[Math.floor(Date.now() / tickMs) % ACTIVITY_SPIN.length];
							const layout = liveStatusLayout(width, 1);
							const indicator = hardTrim(semantic("accent", frame), layout.indicatorColumns);
							const label = hardTrim(semantic("muted", phase), layout.labelColumns);
							return [
								`${" ".repeat(layout.leadingColumns)}${indicator}${" ".repeat(layout.gapColumns)}${label}${mark}`,
							];
						}
						const state = phaseToOrbState(phase);
						const tint =
							ORB_ACCENT_BY_THEME[String(liveState.activeTheme?.name ?? "")] ??
							ORB_ACCENT_BY_THEME["amp-style"];
						const orb = renderOrbGlyph(state, Date.now() / 1000, {
							dark: true,
							tint,
							style: (s) => semantic("accent", s),
						});
						const layout = liveStatusLayout(width, orbColumns());
						const indicator = hardTrim(orb, layout.indicatorColumns);
						const label = hardTrim(semantic("muted", phase), layout.labelColumns);
						return [
							`${" ".repeat(layout.leadingColumns)}${indicator}${" ".repeat(layout.gapColumns)}${label}${mark}`,
						];
					},
					dispose() {
						stopTimer();
					},
				};
			},
			{ placement: "aboveEditor" },
		);
	} catch {
		liveRegionApplied = false;
		try {
			// Restore the stock indicator so a widget failure never leaves a gap.
			ctx.ui.setWorkingIndicator?.();
			ctx.ui.setWorkingVisible(true);
			ctx.ui?.notify?.("amp-pi-style: live region widget failed — stock working indicator kept", "warning");
		} catch {}
	}
}

/** Replace the stock footer via the official `ctx.ui.setFooter` API with a
 *  separate agent-status row: abbreviated cwd/git at the left, context usage
 *  and extension statuses at the right. It never shares the prompt border.
 *  Runs once per session; degrades to the stock footer if the API is missing. */
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
			liveState.activeTheme = theme;
			return {
				invalidate() {},
				render(width: number) {
					try {
						if (width < 12) return [];
						const branch = footerData?.getGitBranch?.() ?? "";
						const cwd = displayPath(Math.max(8, Math.floor(width * 0.4)));
						const left = `${semantic("text", cwd)}${branch ? `  ${semantic("muted", `⭠ ${branch}`)}` : ""}`;
						const pct = contextPercent() ?? "";
						const statuses = [...(footerData?.getExtensionStatuses?.() ?? new Map()).entries()]
							.filter(([key]) => !HIDDEN_STATUS_KEYS.has(key))
							.sort(([a], [b]) => a.localeCompare(b))
							.map(([, t]) => String(t).replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim())
							.filter(Boolean);
						const rightItems = [pct, ...statuses].map((item) => semantic("dim", item));
						const line = statusLine(left, rightItems, width);
						return line ? [line] : [];
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

/** Editor: rounded Pi adaptation that fully inherits the terminal background,
 *  with readable live state in the divider. Activity lives in the turn-status
 *  widget; cwd/git live in the footer. */
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
		// `│ ❯ ` input prefix + `│` right border + 1 slack column. Hitting the
		// exact terminal width makes Ghostty/iTerm auto-wrap the final cell onto
		// the next row, so the bottom border and cursor line collide with wrapped
		// composer text.
		const boxWidth = width - 1;
		const lines: string[] = baseRender.call(this, boxWidth - 5);
		if (lines.length < 2) return markComposer(this, lines);

		// Quiet active/idle borders: accent when focused, muted when idle.
		const bc = (s: string): string => {
			try {
				const fg = liveState.activeTheme?.fg;
				const role = this.focused ? "borderAccent" : "borderMuted";
				return typeof fg === "function" ? fg.call(liveState.activeTheme, role, s) : (typeof this.borderColor === "function" ? this.borderColor(s) : s);
			} catch {
				return typeof this.borderColor === "function" ? this.borderColor(s) : s;
			}
		};

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

		/** Corner + low-volume labels + fill + corner, always exactly `boxWidth`
		 *  columns. Right-side metadata yields before the left scroll indicator. */
		const makeBorder = (leftCorner: string, rightCorner: string, origLine: string, leftLabel = "", rightLabel = "") => {
			const scroll = scrollInfo(origLine);
			let left = [scroll, leftLabel].filter(Boolean).join(" · ");
			let leftPlain = left ? `─ ${left} ` : "";
			let rightPlain = rightLabel ? ` ${rightLabel} ─` : "";
			const inner = boxWidth - 2;

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
			const rightStyled = rightLabel ? ` ${semantic("text", rightLabel)} ${bc("─")}` : "";
			const osc = origLine.match(LEADING_OSC_RE)?.[0] ?? "";
			return osc + bc(leftCorner) + leftStyled + bc("─".repeat(fill)) + rightStyled + bc(rightCorner);
		};

		// Top border: quiet — no metadata, only the scroll indicator.
		lines[0] = makeBorder("╭", "╮", lines[0]);

		// Bottom border: only model/mode information in its divider. Context
		// usage lives in the footer, activity in the turn-status widget.
		const modelName = liveState.session?.modelName ?? "";
		const modelId = liveState.session?.modelId ?? modelName;
		const level = liveState.session?.thinkingLevel ?? "";
		const mode = [modelId, level].filter(Boolean).join(" ─ ");
		lines[bottom] = makeBorder("╰", "╯", lines[bottom], "", mode);

		// Content lines: `│ ❯ ` input prefix, `│   ` aligned continuations,
		// and a `│` right border. Autocomplete stays indented below the box.
		for (let i = 1; i < lines.length; i++) {
			if (i === bottom) continue;
			if (i < bottom) lines[i] = afterLeadingOsc(lines[i], i === 1 ? `${bc("│")} ❯ ` : `${bc("│")}   `) + bc("│");
			else lines[i] = afterLeadingOsc(lines[i], "   ");
		}
		return markComposer(this, lines);
	};
}
