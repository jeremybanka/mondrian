// SPDX-License-Identifier: MPL-2.0

import type { PdfIndirectValue } from "../objects.ts"
import { encodePdfName, encodePdfNameBytes } from "../syntax.ts"

/** Canonical escaped spelling preserves byte identity across IR representations. */
export function pdfName(
	value: PdfIndirectValue | undefined,
): string | undefined {
	if (value !== null && typeof value === "object") {
		if (value.kind === "name") return encodePdfName(value.value)
		if (value.kind === "byte-name") return encodePdfNameBytes(value.bytes)
	}
	return undefined
}

export function nameTokenBytes(value: string | undefined): Uint8Array {
	if (!value?.startsWith("/"))
		throw new TypeError("Expected a PDF resource name")
	return Buffer.from(
		value
			.slice(1)
			.replace(/#([\da-f]{2})/giu, (_, hex: string) =>
				String.fromCharCode(Number.parseInt(hex, 16)),
			),
		"latin1",
	)
}

export function tokenName(value: string | undefined): string {
	return encodePdfNameBytes(nameTokenBytes(value))
}

/** Mondrian string names use UTF-8; arbitrary byte names fall back to Latin-1. */
export function displayName(token: string): string {
	const bytes = nameTokenBytes(token)
	try {
		return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
			bytes,
		)
	} catch {
		return Buffer.from(bytes).toString("latin1")
	}
}
