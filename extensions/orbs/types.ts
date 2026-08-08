/**
 * Thinking-orb state verbs (MIT: Jakubantalik/thinking-orbs).
 * Each maps to a hand-tuned dotted-sphere animation.
 */
export type OrbState =
	| "working"
	| "searching"
	| "solving"
	| "listening"
	| "connecting"
	| "weaving"
	| "composing"
	| "breathing"
	| "shaping";

/** Tuned pixel sizes from upstream — not a scale factor. */
export type OrbSize = 64 | 20;
