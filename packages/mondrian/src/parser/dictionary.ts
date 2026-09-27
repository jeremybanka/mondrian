// SPDX-License-Identifier: MPL-2.0

import type { PdfValue } from "../objects.ts"

/** Own every PDF key, including __proto__; callers freeze the completed map. */
export function dictionaryEntries(
	entries: Iterable<readonly [string, PdfValue | undefined]> = [],
): Record<string, PdfValue | undefined> {
	const result: Record<string, PdfValue | undefined> = Object.create(null)
	for (const [key, value] of entries) result[key] = value
	return result
}
