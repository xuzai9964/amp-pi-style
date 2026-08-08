import { expect, test } from "bun:test";

const extensionSource = await Bun.file(new URL("../extensions/amp-style.ts", import.meta.url)).text();
const ampTheme = JSON.parse(
	await Bun.file(new URL("../themes/amp-style.json", import.meta.url)).text(),
) as { colors: { selectedBg?: string } };

test("composer and transcript rendering never paint a background", () => {
	// Positive controls prove the guard is inspecting the production editor patch
	// and that selectedBg still exists for Pi-owned selection/overlay surfaces.
	expect(extensionSource).toContain("function patchEditor()");
	expect(ampTheme.colors.selectedBg).toBeDefined();

	// The extension must not consume a theme background or emit an ANSI background
	// color. This keeps borders and every input row terminal-inheriting.
	expect(extensionSource).not.toContain("getBgAnsi");
	expect(extensionSource).not.toContain("selectedBg");
	expect(extensionSource).not.toMatch(/\\x1b\[(?:4[0-8]|48(?:;\d+)*)m/);
});
