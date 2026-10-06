// SPDX-License-Identifier: MPL-2.0
import { inflateSync } from "node:zlib"
import { dictionaryValue } from "../dictionary-lookup.ts"
import { iccColorSpace } from "../icc.ts"
import type { PdfIndirectValue, PdfStream, PdfValue } from "../objects.ts"
import { pdfName } from "../testing/plate-names.ts"

export type ResolvePdf = (
	value: PdfValue | undefined,
) => PdfIndirectValue | undefined

export function decodedPdfStream(
	source: PdfStream,
	resolve: ResolvePdf,
	limit: number,
): Uint8Array {
	let filter = resolve(dictionaryValue(source, "Filter"))
	if (
		filter !== null &&
		typeof filter === "object" &&
		filter.kind === "array"
	) {
		if (filter.items.length !== 1)
			throw new TypeError(
				"Only a single FlateDecode stream filter is supported",
			)
		filter = resolve(filter.items[0])
	}
	if (resolve(dictionaryValue(source, "DecodeParms")) != null)
		throw new TypeError("Unexpected stream DecodeParms")
	if (filter == null) {
		if (source.data.length > limit)
			throw new RangeError("Decoded PDF stream exceeds its byte limit")
		return Uint8Array.from(source.data)
	}
	if (pdfName(filter) !== "/FlateDecode")
		throw new TypeError(
			`Unsupported PDF stream filter ${pdfName(filter) ?? "unknown"}`,
		)
	return Uint8Array.from(inflateSync(source.data, { maxOutputLength: limit }))
}

export function readIccSpace(
	value: PdfValue,
	resolve: ResolvePdf,
): { readonly profile: Uint8Array; readonly channels: 1 | 3 | 4 } | undefined {
	const space = resolve(value)
	if (
		space === null ||
		typeof space !== "object" ||
		space.kind !== "array" ||
		pdfName(resolve(space.items[0])) !== "/ICCBased"
	)
		return undefined
	const source = resolve(space.items[1])
	if (
		space.items.length !== 2 ||
		source === null ||
		typeof source !== "object" ||
		source.kind !== "stream"
	)
		throw new TypeError("ICCBased requires an ICC profile stream")
	const profile = decodedPdfStream(source, resolve, 16 * 1024 * 1024)
	const signature = iccColorSpace(profile),
		channels = signature === "RGB " ? 3 : signature === "CMYK" ? 4 : 1
	if (resolve(dictionaryValue(source, "N")) !== channels)
		throw new TypeError("ICC profile channel signature does not agree with N")
	const range = resolve(dictionaryValue(source, "Range"))
	if (
		range != null &&
		(typeof range !== "object" ||
			range.kind !== "array" ||
			range.items.length !== channels * 2 ||
			range.items.some((v, i) => resolve(v) !== i % 2))
	)
		throw new TypeError("Non-default ICCBased component ranges are unsupported")
	const alternateValue = resolve(dictionaryValue(source, "Alternate"))
	const alternate = pdfName(alternateValue)
	if (
		alternateValue != null &&
		alternate !==
			({ 1: "/DeviceGray", 3: "/DeviceRGB", 4: "/DeviceCMYK" } as const)[
				channels
			]
	)
		throw new TypeError(
			"ICC profile Alternate must agree with its component signature",
		)
	return { profile, channels }
}
