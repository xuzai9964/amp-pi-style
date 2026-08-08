// Engine-level contracts shared by every mode implementation.

import type { SoftCtx } from "../soft-canvas";
import type { ModeOpts } from "./profiles";

export type { Dot, Line } from "./core";

/** One frame painter: draws a mode into a soft 2D context at CSS-px `size`. */
export type ModeDraw = (ctx: SoftCtx, size: number, t: number, dark: boolean, opts: ModeOpts) => void;
