import { expect, test } from "bun:test";

// Reproduce the reporter's default environment before loading render.ts,
// whose renderer preference is intentionally captured at module load.
process.env.TERM = "xterm-ghostty";
process.env.TERM_PROGRAM = "ghostty";
process.env.AMP_PI_ORBS = "auto";

const { liveStatusLayout, renderOrbGlyph } = await import("../extensions/orbs/render.ts");

function litDotCounts(glyph: string): number[] {
	return [...glyph].map((cell) => {
		const mask = (cell.codePointAt(0) ?? 0x2800) - 0x2800;
		return mask.toString(2).replaceAll("0", "").length;
	});
}

test("turn-status orb stays on pi-tui's normal text path", () => {
	const statusGlyph = renderOrbGlyph("breathing", 1.25, { dark: true, tint: [187, 154, 247] });

	// pi-tui classifies any line containing Kitty APC (ESC_G) as image-only,
	// which skips normal text/background composition for the whole row.
	expect(statusGlyph).not.toContain("\x1b_G");
	expect([...statusGlyph]).toHaveLength(2);
});

test("thinking orb preserves a hollow two-cell silhouette", () => {
	const glyph = renderOrbGlyph("breathing", 0, { dark: true, tint: [187, 154, 247] });

	// A two-cell orb has 16 possible dots. Lighting half preserves the circular
	// silhouette; max-pooled frames used to saturate both cells as `⣿⣿`.
	expect(litDotCounts(glyph)).toEqual([4, 4]);
});

test("turn-status layout respects narrow widget allocations", () => {
	for (let width = 0; width <= 8; width++) {
		const active = liveStatusLayout(width, 2);
		const inactive = liveStatusLayout(width, 0);
		const activeTotal = active.leadingColumns + active.indicatorColumns + active.gapColumns + active.labelColumns;
		const inactiveTotal =
			inactive.leadingColumns + inactive.indicatorColumns + inactive.gapColumns + inactive.labelColumns;

		expect(activeTotal).toBeLessThanOrEqual(Math.max(0, width - 1));
		expect(inactiveTotal).toBeLessThanOrEqual(Math.max(0, width - 1));
		expect(active.indicatorColumns).toBeLessThanOrEqual(2);
		expect(active.labelColumns === 0 || active.gapColumns === 1).toBe(true);
	}
});
