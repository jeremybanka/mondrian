// SPDX-License-Identifier: MPL-2.0

import type { PdfDictionary, PdfIndirectValue, PdfValue } from "../objects.ts"
import { dictionary } from "../objects.ts"
import { encodePdfName } from "../syntax.ts"
import { pdfName } from "./plate-names.ts"

interface DecodedPlateGraphicsState {
	/** Non-null entries retaining their original references and name representations. */
	readonly source: PdfDictionary
	readonly textKnockout: boolean | undefined
	readonly strokeOverprint: boolean | undefined
	readonly fillOverprint: boolean | undefined
	readonly overprintMode: 0 | 1 | undefined
	readonly fillOpacity: number | undefined
	readonly strokeOpacity: number | undefined
	readonly blendMode: "Normal" | undefined
}

const allowedKeys = new Set(
	"Type OP op OPM ca CA BM SMask LW LC LJ ML D RI FL SA TK"
		.split(" ")
		.map((key) => `/${key}`),
)
const standardBlendModes = new Set(
	"Normal Compatible Multiply Screen Overlay Darken Lighten ColorDodge ColorBurn HardLight SoftLight Difference Exclusion Hue Saturation Color Luminosity"
		.split(" ")
		.map((mode) => `/${mode}`),
)

/** Decode partial updates without applying defaults or depending on text context. */
export function decodePlateGraphicsState(
	value: PdfDictionary,
	resolve: (value: PdfValue | undefined) => PdfIndirectValue | undefined,
): DecodedPlateGraphicsState {
	const fields = new Map<string, PdfIndirectValue>()
	const keep = (key: string, item: PdfValue | undefined): boolean => {
		const resolved = resolve(item)
		if (resolved === null || resolved === undefined) return false
		if (!allowedKeys.has(key))
			throw new TypeError(`Unsupported plate graphics state setting ${key}`)
		fields.set(key, resolved)
		return true
	}
	// Resolve each entry once. Keep its original value separately so output can
	// reuse references while treating both direct and indirect null as absent.
	const source = dictionary(
		Object.fromEntries(
			Object.entries(value.entries).filter(([key, item]) =>
				keep(encodePdfName(key), item),
			),
		),
		...(value.byteEntries ?? []).filter(([key, item]) =>
			keep(pdfName(key)!, item),
		),
	)
	const textKnockout = fields.get("/TK")
	if (textKnockout !== undefined && typeof textKnockout !== "boolean")
		throw new TypeError(
			"Text knockout must be a boolean set outside a text object",
		)
	const strokeOverprint = fields.get("/OP")
	if (strokeOverprint !== undefined && typeof strokeOverprint !== "boolean")
		throw new TypeError("Invalid OP overprint flag")
	const fillOverprint = fields.get("/op")
	if (fillOverprint !== undefined && typeof fillOverprint !== "boolean")
		throw new TypeError("Invalid op overprint flag")
	const overprintMode = fields.get("/OPM")
	if (overprintMode !== undefined && overprintMode !== 0 && overprintMode !== 1)
		throw new TypeError("Invalid overprint mode")
	const opacity = (key: "ca" | "CA"): number | undefined => {
		const alpha = fields.get(`/${key}`)
		if (
			alpha !== undefined &&
			(typeof alpha !== "number" ||
				!Number.isFinite(alpha) ||
				alpha < 0 ||
				alpha > 1)
		)
			throw new TypeError(`Invalid ${key} opacity`)
		return alpha
	}
	const fillOpacity = opacity("ca")
	const strokeOpacity = opacity("CA")
	const blend = fields.get("/BM")
	if (blend !== undefined) {
		let mode = pdfName(blend)
		if (blend !== null && typeof blend === "object" && blend.kind === "array") {
			const modes = blend.items.map((item) => {
				const mode = pdfName(resolve(item))
				if (mode === undefined) throw new TypeError("Expected blend-mode names")
				return mode
			})
			// Recognize all standard modes before checking our support;
			// [Multiply Normal] must not silently become Normal.
			mode = modes.find((item) => standardBlendModes.has(item)) ?? "/Normal"
		}
		if (mode !== "/Normal" && mode !== "/Compatible")
			throw new TypeError("Plate previews support only Normal blending")
	}
	const softMask = fields.get("/SMask")
	if (softMask !== undefined && pdfName(softMask) !== "/None")
		throw new TypeError("Soft masks are unsupported in plate previews")
	return {
		source,
		textKnockout,
		strokeOverprint,
		fillOverprint,
		overprintMode,
		fillOpacity,
		strokeOpacity,
		blendMode: blend === undefined ? undefined : "Normal",
	}
}
