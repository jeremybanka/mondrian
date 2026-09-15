// SPDX-License-Identifier: MPL-2.0

import { ColorScope } from "./color.ts"
import type { PdfObjectBuilder } from "./object-builder.ts"
import type { PdfDictionary } from "./objects.ts"

import type {
	PdfContent,
	PdfContentRecord,
	PdfFont,
	PdfImage,
} from "./content.ts"
import { getContentRecord } from "./content.ts"
import { ascii } from "./objects.ts"
import {
	encodePdfLiteralString,
	encodePdfName,
	formatPdfNumber,
} from "./syntax.ts"

export interface EncodedPageContent {
	readonly colorResources: PdfDictionary
	readonly bytes: Uint8Array
	readonly fonts: ReadonlyMap<PdfFont, string>
	readonly images: ReadonlyMap<PdfImage, string>
}

export function encodePageContent(
	owner: symbol,
	contents: readonly PdfContent[],
	objects: PdfObjectBuilder,
): EncodedPageContent {
	const records = contents.map((content) => getContentRecord(content))
	const fonts = new Map<PdfFont, string>()
	const images = new Map<PdfImage, string>()

	for (const record of records) {
		if (record.owner !== owner) {
			throw new TypeError("PDF content belongs to another document builder")
		}

		for (const operation of record.operations) {
			if (operation.op === "font" && !fonts.has(operation.font)) {
				fonts.set(operation.font, `F${fonts.size}`)
			} else if (operation.op === "drawImage" && !images.has(operation.image)) {
				images.set(operation.image, `Im${images.size}`)
			}
		}
	}

	const colors = new ColorScope(objects)
	const bytes = ascii(encodeRecords(records, fonts, images, colors))
	return {
		bytes,
		colorResources: colors.resources(),
		fonts,
		images,
	}
}

function encodeRecords(
	records: readonly PdfContentRecord[],
	fonts: ReadonlyMap<PdfFont, string>,
	images: ReadonlyMap<PdfImage, string>,
	colors: ColorScope,
): string {
	let result = ""

	for (const record of records) {
		if (record.kind === "text") {
			const scoped = record.operations.some((operation) =>
				["fillColor", "strokeColor", "paintState", "renderingMode"].includes(
					operation.op,
				),
			)
			result += scoped ? "q\nBT\n" : "BT\n"
			for (const operation of record.operations) {
				switch (operation.op) {
					case "fillColor":
					case "strokeColor":
					case "paintState":
						result += colors.encode(operation)
						break
					case "renderingMode":
						result += `${operation.mode} Tr\n`
						break
					case "font":
						result += `${encodePdfName(requireResourceName(fonts, operation.font))} ${number(operation.size)} Tf\n`
						break
					case "moveText":
						result += `${number(operation.x)} ${number(operation.y)} Td\n`
						break
					case "setTextMatrix":
						result += `${matrix(operation)} Tm\n`
						break
					case "leading":
						result += `${number(operation.value)} TL\n`
						break
					case "nextLine":
						result += "T*\n"
						break
					case "show":
						result += `${encodePdfLiteralString(operation.text)} Tj\n`
						break
					case "characterSpacing":
						result += `${number(operation.value)} Tc\n`
						break
					case "wordSpacing":
						result += `${number(operation.value)} Tw\n`
						break
					case "horizontalScale":
						result += `${number(operation.value)} Tz\n`
						break
					case "rise":
						result += `${number(operation.value)} Ts\n`
						break
				}
			}
			result += scoped ? "ET\nQ\n" : "ET\n"
			continue
		}

		result += "q\n"
		for (const operation of record.operations) {
			switch (operation.op) {
				case "fillColor":
				case "strokeColor":
				case "paintState":
					result += colors.encode(operation)
					break
				case "concatMatrix":
					result += `${matrix(operation)} cm\n`
					break
				case "lineWidth":
					result += `${number(operation.width)} w\n`
					break
				case "moveTo":
					result += `${number(operation.x)} ${number(operation.y)} m\n`
					break
				case "lineTo":
					result += `${number(operation.x)} ${number(operation.y)} l\n`
					break
				case "rectangle":
					result += `${number(operation.x)} ${number(operation.y)} ${number(operation.width)} ${number(operation.height)} re\n`
					break
				case "closePath":
					result += "h\n"
					break
				case "stroke":
					result += "S\n"
					break
				case "fill":
					result += "f\n"
					break
				case "fillAndStroke":
					result += "B\n"
					break
				case "drawImage":
					result += `q\n${number(operation.width)} 0 0 ${number(operation.height)} ${number(operation.x)} ${number(operation.y)} cm\n`
					result += `${encodePdfName(requireResourceName(images, operation.image))} Do\nQ\n`
					break
			}
		}
		result += "Q\n"
	}

	return result
}

function number(value: number): string {
	return formatPdfNumber(value)
}

function matrix(value: {
	readonly a: number
	readonly b: number
	readonly c: number
	readonly d: number
	readonly e: number
	readonly f: number
}): string {
	return [value.a, value.b, value.c, value.d, value.e, value.f]
		.map(number)
		.join(" ")
}

function requireResourceName<TResource>(
	resources: ReadonlyMap<TResource, string>,
	resource: TResource,
): string {
	const name = resources.get(resource)
	if (name === undefined) {
		throw new Error("A PDF content resource was not collected")
	}

	return name
}
