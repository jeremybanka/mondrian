// SPDX-License-Identifier: MPL-2.0
import type { PdfRenderingIntent } from "./print-image.ts"

export function pdfIntent(intent: PdfRenderingIntent): string {
	const names = {
		perceptual: "Perceptual",
		"relative-colorimetric": "RelativeColorimetric",
		saturation: "Saturation",
		"absolute-colorimetric": "AbsoluteColorimetric",
	}
	if (!Object.hasOwn(names, intent))
		throw new TypeError("Unsupported rendering intent")
	return names[intent]
}
