// SPDX-License-Identifier: MPL-2.0

import type { PdfDictionary, PdfValue } from "./objects.ts"
import { encodePdfName, encodePdfNameBytes, isPdfName } from "./syntax.ts"

/** Resolve a logical dictionary key regardless of its public representation. */
export function dictionaryValue(
	dictionary: Pick<PdfDictionary, "entries" | "byteEntries"> | undefined,
	key: string,
): PdfValue | undefined {
	const direct = dictionary?.entries[key]
	if (direct !== undefined) return direct
	for (const entry of dictionary?.byteEntries ?? []) {
		if (!Array.isArray(entry)) continue
		const candidate = entry[0]
		if (
			isPdfName(candidate, key) ||
			(candidate?.kind === "byte-name" &&
				candidate.bytes instanceof Uint8Array &&
				encodePdfNameBytes(candidate.bytes) === encodePdfName(key))
		)
			return entry[1]
	}
	return undefined
}
