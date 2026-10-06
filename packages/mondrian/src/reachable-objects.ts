// SPDX-License-Identifier: MPL-2.0
import type {
	PdfDocument,
	PdfIndirectObject,
	PdfIndirectValue,
	PdfReference,
} from "./objects.ts"

/** Retain document roots without expanding shared nodes or following cycles twice. */
export function reachableObjects(
	document: PdfDocument,
	objects: readonly PdfIndirectObject[],
): PdfIndirectObject[] {
	const byNumber = new Map(
		objects.map((object) => [
			`${object.objectNumber}:${object.generation}`,
			object,
		]),
	)
	const reachable = new Set<string>(),
		visited = new WeakSet<object>()
	const pending: (PdfIndirectValue | PdfReference | undefined)[] = [
		document.root,
		document.info,
	]
	while (pending.length) {
		const value = pending.pop()
		if (value === null || typeof value !== "object" || visited.has(value))
			continue
		visited.add(value)
		if (value.kind === "reference") {
			const key = `${value.objectNumber}:${value.generation}`
			if (reachable.has(key)) continue
			reachable.add(key)
			pending.push(byNumber.get(key)?.value)
		} else if (value.kind === "array")
			for (const item of value.items) pending.push(item)
		else if (value.kind === "dictionary" || value.kind === "stream") {
			for (const item of Object.values(value.entries)) pending.push(item)
			for (const [, item] of value.byteEntries ?? []) pending.push(item)
		}
	}
	return objects.filter((object) =>
		reachable.has(`${object.objectNumber}:${object.generation}`),
	)
}
