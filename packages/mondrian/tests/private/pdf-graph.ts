import { isDeepStrictEqual } from "node:util"
import type { PdfDocument } from "../../src/index.ts"

/** Compare every graph value and byte without requiring an object-array order. */
export function samePdfGraph(left: PdfDocument, right: PdfDocument): boolean {
	const ordered = (document: PdfDocument) => ({
		...document,
		objects: document.objects.toSorted(
			(a, b) => a.objectNumber - b.objectNumber || a.generation - b.generation,
		),
	})
	return isDeepStrictEqual(ordered(left), ordered(right))
}
