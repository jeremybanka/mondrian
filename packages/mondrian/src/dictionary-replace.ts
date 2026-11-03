// SPDX-License-Identifier: MPL-2.0
import type { PdfDictionary, PdfValue } from "./objects.ts"
import { dictionary } from "./objects.ts"
import { encodePdfName } from "./syntax.ts"
import { pdfName } from "./pdf-names.ts"

export function replaceEntries(
	value: Pick<PdfDictionary, "entries" | "byteEntries">,
	changes: Record<string, PdfValue | undefined>,
): PdfDictionary {
	const entries = { ...value.entries, ...changes }
	const replaced = new Set(Object.keys(changes).map(encodePdfName))
	return dictionary(
		entries,
		...(value.byteEntries ?? []).filter(
			([key]) => !replaced.has(pdfName(key)!),
		),
	)
}
