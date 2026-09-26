// SPDX-License-Identifier: MPL-2.0

import type { PlateInk, PlatePaint } from "./plate-plan.ts"

export type TextMode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

interface PaintChannels {
	readonly fill: boolean
	readonly stroke: boolean
}

export interface PathShape {
	readonly close: boolean
	readonly evenOdd: boolean
}

// Decode source operators once, before projecting their channels onto plates.
export const pathPainting: ReadonlyMap<string, PaintChannels & PathShape> =
	new Map([
		["S", { fill: false, stroke: true, close: false, evenOdd: false }],
		["s", { fill: false, stroke: true, close: true, evenOdd: false }],
		["f", { fill: true, stroke: false, close: false, evenOdd: false }],
		["F", { fill: true, stroke: false, close: false, evenOdd: false }],
		["f*", { fill: true, stroke: false, close: false, evenOdd: true }],
		["B", { fill: true, stroke: true, close: false, evenOdd: false }],
		["B*", { fill: true, stroke: true, close: false, evenOdd: true }],
		["b", { fill: true, stroke: true, close: true, evenOdd: false }],
		["b*", { fill: true, stroke: true, close: true, evenOdd: true }],
	])

export function pathPaintOperator(
	{ fill, stroke }: PaintChannels,
	evenOdd: boolean,
): string {
	if (fill && stroke) return evenOdd ? "B*" : "B"
	if (fill) return evenOdd ? "f*" : "f"
	return stroke ? "S" : "n"
}

export function textPainting(
	mode: TextMode,
): PaintChannels & { clip: boolean } {
	const paint = mode % 4
	return {
		fill: paint === 0 || paint === 2,
		stroke: paint === 1 || paint === 2,
		clip: mode >= 4,
	}
}

export function textPaintMode(
	{ fill, stroke }: PaintChannels,
	clip: boolean,
): TextMode {
	if (fill && stroke) return clip ? 6 : 2
	if (fill) return clip ? 4 : 0
	if (stroke) return clip ? 5 : 1
	return clip ? 7 : 3
}

export type ProjectedPaint =
	| { readonly kind: "skip" }
	| { readonly kind: "knockout" | "ink"; readonly color: PlatePaint["color"] }

/** Skipping leaves earlier ink untouched; a zero-valued paint still occludes it. */
export function projectPaint(
	paint: PlatePaint | undefined,
	plate: PlateInk,
): ProjectedPaint {
	if (paint === undefined) return { kind: "skip" }
	const { color, overprint, mode } = paint
	if (color.space === "cmyk" && plate.colorSpace === "cmyk") {
		const value = color.components[plate.component]
		if (overprint && mode === 1 && value === 0) return { kind: "skip" }
		const components: [number, number, number, number] = [0, 0, 0, 0]
		components[plate.component] = value
		return {
			kind: value === 0 ? "knockout" : "ink",
			color: { space: "cmyk", components },
		}
	}
	if (
		color.space === "spot" &&
		plate.colorSpace === "spot" &&
		plate.ink === color.ink
	)
		// Even zero tint must retain the source ink's alternate-space transform.
		return { kind: color.components[0] === 0 ? "knockout" : "ink", color }
	return overprint
		? { kind: "skip" }
		: { kind: "knockout", color: { space: "cmyk", components: [0, 0, 0, 0] } }
}
