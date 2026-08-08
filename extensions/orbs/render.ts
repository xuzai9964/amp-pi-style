/**
 * Terminal renderer for thinking-orbs.
 * The live status row uses Braille so pi-tui keeps its normal text/background
 * composition path. Animation math is ported from Jakubantalik/thinking-orbs (MIT).
 */

import { MODE_DRAWS } from "./engine/registry";
import { resolvePreset } from "./presets";
import { SoftCanvas } from "./soft-canvas";
import type { OrbState } from "./types";

export type OrbRenderMode = "auto" | "braille" | "off";

const ORB_SIZE = 20 as const;
/** Braille glyph width in terminal columns (each cell is 2×4 dots). */
const BRAILLE_COLS = 2;
const BRAILLE_DOT_W = BRAILLE_COLS * 2;
const BRAILLE_DOT_H = 4;
/** Keep half of the 4×4 Braille sample grid lit so silhouettes stay hollow. */
const BRAILLE_LIT_DOTS = (BRAILLE_DOT_W * BRAILLE_DOT_H) / 2;

const ORB_ENV = (process.env.AMP_PI_ORBS ?? "auto").trim().toLowerCase();

export function orbMode(): OrbRenderMode {
	if (/^(0|false|off|no|none)$/i.test(ORB_ENV)) return "off";
	// `kitty` used to inject an APC into a mixed image+text status row. pi-tui
	// classifies any such row as image-only and skips normal background handling,
	// so accept the old value as a safe Braille fallback rather than regressing UI.
	if (ORB_ENV === "braille" || ORB_ENV === "kitty") return "braille";
	return "auto";
}

/** Map amp-pi-style turn-status phase text → cute orb state. */
export function phaseToOrbState(phase: string): OrbState {
	const p = phase.toLowerCase();
	if (p.startsWith("search")) return "searching";
	if (p.startsWith("edit")) return "shaping";
	if (p.startsWith("read")) return "connecting";
	if (p.startsWith("respond")) return "composing";
	if (p.startsWith("think")) return "breathing";
	if (p.startsWith("run") && p.includes("command")) return "working";
	if (p.startsWith("run") && p.includes("tool")) return "weaving";
	if (p.startsWith("work")) return "working";
	if (p.startsWith("listen")) return "listening";
	if (p.startsWith("solv")) return "solving";
	return "working";
}

/** Visible column width of the Braille orb glyph. */
export function orbColumns(): number {
	return orbMode() === "off" ? 0 : BRAILLE_COLS;
}

export type LiveStatusLayout = {
	leadingColumns: number;
	indicatorColumns: number;
	gapColumns: number;
	labelColumns: number;
};

/** Allocate a one-line status indicator without using the terminal's final
 *  column. The indicator wins at very narrow widths; a label appears only when
 *  there is room for both its separating space and at least one text cell. */
export function liveStatusLayout(width: number, wantedIndicatorColumns: number): LiveStatusLayout {
	const contentColumns = Math.max(0, width - 1);
	const wanted = Math.max(0, wantedIndicatorColumns);
	const leadingColumns = contentColumns > wanted ? 1 : 0;
	const indicatorColumns = Math.min(wanted, contentColumns - leadingColumns);
	const remaining = contentColumns - leadingColumns - indicatorColumns;
	const gapColumns = remaining >= 2 ? 1 : 0;
	const labelColumns = gapColumns ? remaining - gapColumns : 0;
	return { leadingColumns, indicatorColumns, gapColumns, labelColumns };
}

function tintPixels(pixels: Uint8ClampedArray, tint: [number, number, number] | null) {
	if (!tint) return;
	const [tr, tg, tb] = tint;
	for (let i = 0; i < pixels.length; i += 4) {
		const a = pixels[i + 3];
		if (a < 8) continue;
		const lum = (pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114) / 255;
		// Keep near-white highlights; wash midtones with a soft accent (cute, not neon).
		const mix = 0.22 + 0.35 * (1 - lum);
		pixels[i] = Math.round(pixels[i] * (1 - mix) + tr * mix);
		pixels[i + 1] = Math.round(pixels[i + 1] * (1 - mix) + tg * mix);
		pixels[i + 2] = Math.round(pixels[i + 2] * (1 - mix) + tb * mix);
	}
}

/** Draw one RGBA frame for the given orb state. */
export function renderOrbPixels(
	state: OrbState,
	tSec: number,
	opts?: { dark?: boolean; tint?: [number, number, number] | null; speed?: number },
): Uint8ClampedArray {
	const dark = opts?.dark ?? true;
	const { mode, speed, opts: drawOpts } = resolvePreset(state, ORB_SIZE);
	const draw = MODE_DRAWS[mode];
	const canvas = new SoftCanvas(ORB_SIZE);
	canvas.clearRect(0, 0, ORB_SIZE, ORB_SIZE);
	draw(canvas, ORB_SIZE, tSec * speed * (opts?.speed ?? 1.05), dark, drawOpts);
	tintPixels(canvas.pixels, opts?.tint ?? null);
	return canvas.pixels;
}

/** Sample RGBA into a 2-cell Braille orb (4×4 dots) — cute, always available. */
export function brailleOrb(pixels: Uint8ClampedArray): string {
	// Braille dot bits per cell:
	// 1 4
	// 2 5
	// 3 6
	// 7 8
	const bitAt = [
		[0x01, 0x08],
		[0x02, 0x10],
		[0x04, 0x20],
		[0x40, 0x80],
	];
	// Area-average each 5×5 region. Max pooling (especially after dilation)
	// lets one faint particle saturate a whole Braille dot, turning dense rings
	// into a solid `⣿⣿` rectangle instead of preserving their silhouette.
	const scores: Array<{ cell: number; dx: number; dy: number; index: number; energy: number }> = [];
	for (let cell = 0; cell < BRAILLE_COLS; cell++) {
		for (let dy = 0; dy < BRAILLE_DOT_H; dy++) {
			for (let dx = 0; dx < 2; dx++) {
				const x0 = Math.floor(((cell * 2 + dx) / BRAILLE_DOT_W) * ORB_SIZE);
				const x1 = Math.min(ORB_SIZE, Math.ceil(((cell * 2 + dx + 1) / BRAILLE_DOT_W) * ORB_SIZE));
				const y0 = Math.floor((dy / BRAILLE_DOT_H) * ORB_SIZE);
				const y1 = Math.min(ORB_SIZE, Math.ceil(((dy + 1) / BRAILLE_DOT_H) * ORB_SIZE));
				let energy = 0;
				let samples = 0;
				for (let y = y0; y < y1; y++) {
					for (let x = x0; x < x1; x++) {
						const i = (y * ORB_SIZE + x) * 4;
						const a = pixels[i + 3] / 255;
						const lum = (pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114) / 255;
						energy += a * Math.max(lum, 0.15);
						samples++;
					}
				}
				scores.push({
					cell,
					dx,
					dy,
					index: dy * BRAILLE_DOT_W + cell * 2 + dx,
					energy: samples ? energy / samples : 0,
				});
			}
		}
	}

	const ranked = [...scores].sort((a, b) => b.energy - a.energy || a.index - b.index);
	if ((ranked[0]?.energy ?? 0) <= 0) return "··";
	const lit = new Set(ranked.slice(0, BRAILLE_LIT_DOTS).map((dot) => dot.index));
	let out = "";
	for (let cell = 0; cell < BRAILLE_COLS; cell++) {
		let mask = 0;
		for (const dot of scores) {
			if (dot.cell === cell && lit.has(dot.index)) mask |= bitAt[dot.dy][dot.dx];
		}
		out += String.fromCodePoint(0x2800 + mask);
	}
	return out;
}

/** One status-line orb prefix. Never emit Kitty APC into this mixed text row. */
export function renderOrbGlyph(
	state: OrbState,
	tSec: number,
	opts?: { dark?: boolean; tint?: [number, number, number] | null; style?: (s: string) => string },
): string {
	if (orbMode() === "off") return "";
	const glyphs = brailleOrb(renderOrbPixels(state, tSec, opts));
	return opts?.style ? opts.style(glyphs) : glyphs;
}
