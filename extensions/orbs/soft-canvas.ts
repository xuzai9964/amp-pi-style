/**
 * Minimal software Canvas2D used by the thinking-orbs painters.
 * Only the path/fill/stroke ops the engine calls are implemented.
 */

export type SoftCtx = {
	fillStyle: string;
	strokeStyle: string;
	lineWidth: number;
	clearRect(x: number, y: number, w: number, h: number): void;
	beginPath(): void;
	arc(x: number, y: number, r: number, _a0: number, _a1: number): void;
	moveTo(x: number, y: number): void;
	lineTo(x: number, y: number): void;
	fill(): void;
	stroke(): void;
};

type PathCmd =
	| { kind: "arc"; x: number; y: number; r: number }
	| { kind: "move"; x: number; y: number }
	| { kind: "line"; x: number; y: number };

function parseRgba(style: string): [number, number, number, number] {
	const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+)\s*)?\)$/i.exec(style);
	if (!m) return [255, 255, 255, 1];
	return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] == null ? 1 : Number(m[4])];
}

/** Premultiplied-style over blend into an opaque/transparent RGBA buffer. */
function blend(buf: Uint8ClampedArray, i: number, r: number, g: number, b: number, a: number) {
	if (a <= 0) return;
	if (a >= 1) {
		buf[i] = r;
		buf[i + 1] = g;
		buf[i + 2] = b;
		buf[i + 3] = 255;
		return;
	}
	const inv = 1 - a;
	buf[i] = Math.round(r * a + buf[i] * inv);
	buf[i + 1] = Math.round(g * a + buf[i + 1] * inv);
	buf[i + 2] = Math.round(b * a + buf[i + 2] * inv);
	buf[i + 3] = Math.min(255, Math.round(a * 255 + buf[i + 3] * inv));
}

export class SoftCanvas implements SoftCtx {
	readonly width: number;
	readonly height: number;
	readonly pixels: Uint8ClampedArray;
	fillStyle = "rgba(255,255,255,1)";
	strokeStyle = "rgba(255,255,255,1)";
	lineWidth = 1;
	private path: PathCmd[] = [];

	constructor(size: number) {
		this.width = size;
		this.height = size;
		this.pixels = new Uint8ClampedArray(size * size * 4);
	}

	clearRect(_x: number, _y: number, _w: number, _h: number): void {
		this.pixels.fill(0);
	}

	beginPath(): void {
		this.path = [];
	}

	arc(x: number, y: number, r: number, _a0: number, _a1: number): void {
		this.path.push({ kind: "arc", x, y, r });
	}

	moveTo(x: number, y: number): void {
		this.path.push({ kind: "move", x, y });
	}

	lineTo(x: number, y: number): void {
		this.path.push({ kind: "line", x, y });
	}

	fill(): void {
		const [r, g, b, a] = parseRgba(this.fillStyle);
		for (const cmd of this.path) {
			if (cmd.kind !== "arc") continue;
			this.fillCircle(cmd.x, cmd.y, cmd.r, r, g, b, a);
		}
		this.path = [];
	}

	stroke(): void {
		const [r, g, b, a] = parseRgba(this.strokeStyle);
		const w = Math.max(0.5, this.lineWidth);
		let x0 = 0;
		let y0 = 0;
		let has = false;
		for (const cmd of this.path) {
			if (cmd.kind === "move") {
				x0 = cmd.x;
				y0 = cmd.y;
				has = true;
			} else if (cmd.kind === "line" && has) {
				this.strokeSegment(x0, y0, cmd.x, cmd.y, w, r, g, b, a);
				x0 = cmd.x;
				y0 = cmd.y;
			}
		}
		this.path = [];
	}

	private fillCircle(cx: number, cy: number, radius: number, r: number, g: number, b: number, a: number) {
		const rad = Math.max(0.35, radius);
		const x0 = Math.max(0, Math.floor(cx - rad - 1));
		const y0 = Math.max(0, Math.floor(cy - rad - 1));
		const x1 = Math.min(this.width - 1, Math.ceil(cx + rad + 1));
		const y1 = Math.min(this.height - 1, Math.ceil(cy + rad + 1));
		const rr = rad * rad;
		for (let y = y0; y <= y1; y++) {
			for (let x = x0; x <= x1; x++) {
				const dx = x + 0.5 - cx;
				const dy = y + 0.5 - cy;
				const d2 = dx * dx + dy * dy;
				if (d2 > rr) continue;
				// Soft edge for small dots (cute, less jagged at 20px).
				const edge = Math.max(0, Math.min(1, (rad - Math.sqrt(d2)) * 1.6));
				const aa = a * (0.35 + 0.65 * edge);
				blend(this.pixels, (y * this.width + x) * 4, r, g, b, aa);
			}
		}
	}

	private strokeSegment(
		x0: number,
		y0: number,
		x1: number,
		y1: number,
		width: number,
		r: number,
		g: number,
		b: number,
		a: number,
	) {
		const dx = x1 - x0;
		const dy = y1 - y0;
		const len = Math.hypot(dx, dy);
		if (len < 1e-6) return;
		const steps = Math.max(1, Math.ceil(len * 2));
		const rad = Math.max(0.4, width * 0.55);
		for (let i = 0; i <= steps; i++) {
			const t = i / steps;
			this.fillCircle(x0 + dx * t, y0 + dy * t, rad, r, g, b, a * 0.85);
		}
	}
}
