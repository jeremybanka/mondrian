import type { PdfLiteralString } from "./objects.ts"
import { literalString } from "./objects.ts"

declare const pdfFontBrand: unique symbol
declare const pdfImageBrand: unique symbol
declare const pdfContentBrand: unique symbol

/** An opaque font resource owned by one PDF document builder. */
export interface PdfFont {
	readonly [pdfFontBrand]: "PdfFont"
}

/** An opaque image resource owned by one PDF document builder. */
export interface PdfImage {
	readonly [pdfImageBrand]: "PdfImage"
}

/** An opaque, automatically scoped page-content fragment. */
export interface PdfContent {
	readonly [pdfContentBrand]: "PdfContent"
}

export type StandardFontName =
	| "Times-Roman"
	| "Times-Bold"
	| "Times-Italic"
	| "Times-BoldItalic"
	| "Helvetica"
	| "Helvetica-Bold"
	| "Helvetica-Oblique"
	| "Helvetica-BoldOblique"
	| "Courier"
	| "Courier-Bold"
	| "Courier-Oblique"
	| "Courier-BoldOblique"
	| "Symbol"
	| "ZapfDingbats"

export type PdfImageBitsPerComponent = 8

export type PdfImageColorSpace = "DeviceGray" | "DeviceRGB"

export interface PdfTextBuilder {
	font(font: PdfFont, size: number): PdfTextBuilder
	moveText(x: number, y: number): PdfTextBuilder
	setTextMatrix(
		a: number,
		b: number,
		c: number,
		d: number,
		e: number,
		f: number,
	): PdfTextBuilder
	leading(value: number): PdfTextBuilder
	nextLine(): PdfTextBuilder
	show(value: string | PdfLiteralString): PdfTextBuilder
	characterSpacing(value: number): PdfTextBuilder
	wordSpacing(value: number): PdfTextBuilder
	horizontalScale(value: number): PdfTextBuilder
	rise(value: number): PdfTextBuilder
}

export interface PdfGraphicsBuilder {
	concatMatrix(
		a: number,
		b: number,
		c: number,
		d: number,
		e: number,
		f: number,
	): PdfGraphicsBuilder
	lineWidth(width: number): PdfGraphicsBuilder
	rgbFill(red: number, green: number, blue: number): PdfGraphicsBuilder
	rgbStroke(red: number, green: number, blue: number): PdfGraphicsBuilder
	moveTo(x: number, y: number): PdfGraphicsBuilder
	lineTo(x: number, y: number): PdfGraphicsBuilder
	rectangle(
		x: number,
		y: number,
		width: number,
		height: number,
	): PdfGraphicsBuilder
	closePath(): PdfGraphicsBuilder
	stroke(): PdfGraphicsBuilder
	fill(): PdfGraphicsBuilder
	fillAndStroke(): PdfGraphicsBuilder
	drawImage(
		image: PdfImage,
		x: number,
		y: number,
		width: number,
		height: number,
	): PdfGraphicsBuilder
}

export type PdfTextOperation =
	| Readonly<{
			op: "font"
			font: PdfFont
			size: number
	  }>
	| Readonly<{
			op: "moveText"
			x: number
			y: number
	  }>
	| Readonly<{
			op: "setTextMatrix"
			a: number
			b: number
			c: number
			d: number
			e: number
			f: number
	  }>
	| Readonly<{
			op: "leading"
			value: number
	  }>
	| Readonly<{
			op: "nextLine"
	  }>
	| Readonly<{
			op: "show"
			text: PdfLiteralString
	  }>
	| Readonly<{
			op: "characterSpacing"
			value: number
	  }>
	| Readonly<{
			op: "wordSpacing"
			value: number
	  }>
	| Readonly<{
			op: "horizontalScale"
			value: number
	  }>
	| Readonly<{
			op: "rise"
			value: number
	  }>

export type PdfGraphicsOperation =
	| Readonly<{
			op: "concatMatrix"
			a: number
			b: number
			c: number
			d: number
			e: number
			f: number
	  }>
	| Readonly<{
			op: "lineWidth"
			width: number
	  }>
	| Readonly<{
			op: "rgbFill"
			red: number
			green: number
			blue: number
	  }>
	| Readonly<{
			op: "rgbStroke"
			red: number
			green: number
			blue: number
	  }>
	| Readonly<{
			op: "moveTo"
			x: number
			y: number
	  }>
	| Readonly<{
			op: "lineTo"
			x: number
			y: number
	  }>
	| Readonly<{
			op: "rectangle"
			x: number
			y: number
			width: number
			height: number
	  }>
	| Readonly<{
			op: "closePath"
	  }>
	| Readonly<{
			op: "stroke"
	  }>
	| Readonly<{
			op: "fill"
	  }>
	| Readonly<{
			op: "fillAndStroke"
	  }>
	| Readonly<{
			op: "drawImage"
			image: PdfImage
			x: number
			y: number
			width: number
			height: number
	  }>

export interface PdfFontRecord {
	readonly owner: symbol
	readonly baseFont: StandardFontName
}

export interface PdfImageRecord {
	readonly owner: symbol
	readonly bytes: Uint8Array
	readonly width: number
	readonly height: number
	readonly bitsPerComponent: PdfImageBitsPerComponent
	readonly colorSpace: PdfImageColorSpace
}

export interface PdfTextContentRecord {
	readonly owner: symbol
	readonly kind: "text"
	readonly operations: readonly PdfTextOperation[]
}

export interface PdfGraphicsContentRecord {
	readonly owner: symbol
	readonly kind: "graphics"
	readonly operations: readonly PdfGraphicsOperation[]
}

export type PdfContentRecord = PdfTextContentRecord | PdfGraphicsContentRecord

const standardFontNames: ReadonlySet<string> = new Set([
	"Times-Roman",
	"Times-Bold",
	"Times-Italic",
	"Times-BoldItalic",
	"Helvetica",
	"Helvetica-Bold",
	"Helvetica-Oblique",
	"Helvetica-BoldOblique",
	"Courier",
	"Courier-Bold",
	"Courier-Oblique",
	"Courier-BoldOblique",
	"Symbol",
	"ZapfDingbats",
])

const winAnsiSpecialCharacters = new Map<number, number>([
	[0x20ac, 0x80],
	[0x201a, 0x82],
	[0x0192, 0x83],
	[0x201e, 0x84],
	[0x2026, 0x85],
	[0x2020, 0x86],
	[0x2021, 0x87],
	[0x02c6, 0x88],
	[0x2030, 0x89],
	[0x0160, 0x8a],
	[0x2039, 0x8b],
	[0x0152, 0x8c],
	[0x017d, 0x8e],
	[0x2018, 0x91],
	[0x2019, 0x92],
	[0x201c, 0x93],
	[0x201d, 0x94],
	[0x2022, 0x95],
	[0x2013, 0x96],
	[0x2014, 0x97],
	[0x02dc, 0x98],
	[0x2122, 0x99],
	[0x0161, 0x9a],
	[0x203a, 0x9b],
	[0x0153, 0x9c],
	[0x017e, 0x9e],
	[0x0178, 0x9f],
])

const fontRecords = new WeakMap<PdfFont, PdfFontRecord>()
const imageRecords = new WeakMap<PdfImage, PdfImageRecord>()
const contentRecords = new WeakMap<PdfContent, PdfContentRecord>()

export function createFontHandle(
	owner: symbol,
	baseFont: StandardFontName,
): PdfFont {
	assertOwner(owner)
	if (!standardFontNames.has(baseFont)) {
		throw new TypeError(`Unknown PDF standard font: ${String(baseFont)}`)
	}

	const font = Object.freeze({}) as PdfFont
	fontRecords.set(font, Object.freeze({ owner, baseFont }))
	return font
}

export function createImageHandle(owner: symbol, bytes: Uint8Array): PdfImage {
	assertOwner(owner)
	if (!(bytes instanceof Uint8Array)) {
		throw new TypeError("PDF image data must be a Uint8Array")
	}

	if (bytes.length === 0) {
		throw new RangeError("PDF image data cannot be empty")
	}

	const metadata = parseJpeg(bytes)

	const image = Object.freeze({}) as PdfImage
	imageRecords.set(
		image,
		Object.freeze({
			owner,
			bytes: bytes.slice(),
			...metadata,
		}),
	)
	return image
}

function parseJpeg(bytes: Uint8Array): Omit<PdfImageRecord, "owner" | "bytes"> {
	if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
		throw new TypeError("JPEG data must start with an SOI marker")
	}

	let offset = 2
	let inEntropyData = false
	let foundScan = false
	let foundEnd = false
	let foundQuantizationTable = false
	let foundHuffmanTable = false
	let entropyBytes = 0
	const quantizationTables = new Set<number>()
	const dcHuffmanTables = new Set<number>()
	const acHuffmanTables = new Set<number>()
	let frameComponents: ReadonlyMap<number, number> | undefined
	let metadata: Omit<PdfImageRecord, "owner" | "bytes"> | undefined

	while (offset < bytes.length) {
		if (bytes[offset] !== 0xff) {
			if (!inEntropyData) {
				throw new TypeError("JPEG data contains bytes outside a marker segment")
			}

			entropyBytes += 1
			offset += 1
			continue
		}

		while (bytes[offset] === 0xff) {
			offset += 1
		}

		const marker = bytes[offset]
		offset += 1
		if (marker === undefined) {
			break
		}

		if (marker === 0x00 && inEntropyData) {
			entropyBytes += 1
			continue
		}

		if (marker === 0xd9) {
			foundEnd = true
			break
		}

		if (
			marker === 0x01 ||
			marker === 0xd8 ||
			(marker >= 0xd0 && marker <= 0xd7)
		) {
			continue
		}

		inEntropyData = false

		if (offset + 2 > bytes.length) {
			throw new TypeError("JPEG marker is missing its segment length")
		}

		const length =
			((bytes[offset] as number) << 8) | (bytes[offset + 1] as number)
		if (length < 2 || offset + length > bytes.length) {
			throw new TypeError("JPEG marker has an invalid segment length")
		}

		const payload = offset + 2
		if (marker === 0xdb) {
			parseQuantizationTables(bytes, payload, length - 2, quantizationTables)
			foundQuantizationTable = true
		} else if (marker === 0xc4) {
			parseHuffmanTables(
				bytes,
				payload,
				length - 2,
				dcHuffmanTables,
				acHuffmanTables,
			)
			foundHuffmanTable = true
		}

		if (isStartOfFrame(marker)) {
			if (length < 8) {
				throw new TypeError("JPEG frame header is truncated")
			}

			const bitsPerComponent = bytes[payload]
			const height = readUint16(bytes, payload + 1)
			const width = readUint16(bytes, payload + 3)
			const components = bytes[payload + 5]
			if (
				components === undefined ||
				length !== 8 + components * 3 ||
				width <= 0 ||
				height <= 0
			) {
				throw new TypeError("JPEG frame header is invalid")
			}

			if (bitsPerComponent !== 8) {
				throw new TypeError("Only 8-bit JPEG images are supported")
			}

			if (components !== 1 && components !== 3) {
				throw new TypeError(
					"Only grayscale and three-component JPEG images are supported",
				)
			}

			metadata = {
				width,
				height,
				bitsPerComponent: 8,
				colorSpace: components === 1 ? "DeviceGray" : "DeviceRGB",
			}
			const parsedComponents = new Map<number, number>()
			for (let index = 0; index < components; index += 1) {
				const componentOffset = payload + 6 + index * 3
				const identifier = bytes[componentOffset]
				const sampling = bytes[componentOffset + 1]
				const quantizationTable = bytes[componentOffset + 2]
				if (
					identifier === undefined ||
					sampling === undefined ||
					quantizationTable === undefined ||
					parsedComponents.has(identifier) ||
					quantizationTable > 3
				) {
					throw new TypeError("JPEG frame components are invalid")
				}
				const horizontalSampling = sampling >>> 4
				const verticalSampling = sampling & 0x0f
				if (
					horizontalSampling < 1 ||
					horizontalSampling > 4 ||
					verticalSampling < 1 ||
					verticalSampling > 4
				) {
					throw new TypeError("JPEG frame sampling factors are invalid")
				}

				parsedComponents.set(identifier, quantizationTable)
			}
			frameComponents = parsedComponents
		} else if (isAnyStartOfFrame(marker)) {
			throw new TypeError("Only baseline JPEG images are supported")
		}

		if (marker === 0xda) {
			validateScanHeader(
				bytes,
				payload,
				length,
				frameComponents,
				quantizationTables,
				dcHuffmanTables,
				acHuffmanTables,
			)
			foundScan = true
			inEntropyData = true
		}

		offset += length
	}

	if (metadata === undefined) {
		throw new TypeError("JPEG data does not contain a supported frame header")
	}

	if (
		!foundScan ||
		!foundEnd ||
		!foundQuantizationTable ||
		!foundHuffmanTable ||
		entropyBytes === 0
	) {
		throw new TypeError(
			"JPEG data must contain quantization, Huffman, scan-data, and EOI segments",
		)
	}

	return metadata
}

function readUint16(bytes: Uint8Array, offset: number): number {
	return ((bytes[offset] as number) << 8) | (bytes[offset + 1] as number)
}

function isStartOfFrame(marker: number): boolean {
	return marker === 0xc0
}

function isAnyStartOfFrame(marker: number): boolean {
	return (
		marker >= 0xc0 &&
		marker <= 0xcf &&
		marker !== 0xc4 &&
		marker !== 0xc8 &&
		marker !== 0xcc
	)
}

function parseQuantizationTables(
	bytes: Uint8Array,
	offset: number,
	length: number,
	result: Set<number>,
): void {
	const end = offset + length
	while (offset < end) {
		const specification = bytes[offset]
		if (specification === undefined) {
			throw new TypeError("JPEG quantization table is truncated")
		}

		const precision = specification >>> 4
		const identifier = specification & 0x0f
		if (precision > 1 || identifier > 3) {
			throw new TypeError("JPEG quantization table is invalid")
		}

		const coefficientBytes = precision === 0 ? 1 : 2
		for (let index = 0; index < 64; index += 1) {
			const coefficientOffset = offset + 1 + index * coefficientBytes
			const coefficient =
				coefficientBytes === 1
					? bytes[coefficientOffset]
					: readUint16(bytes, coefficientOffset)
			if (coefficient === 0 || coefficient === undefined) {
				throw new TypeError(
					"JPEG quantization coefficients must be greater than zero",
				)
			}
		}

		offset += 1 + coefficientBytes * 64
		if (offset > end) {
			throw new TypeError("JPEG quantization table is truncated")
		}
		result.add(identifier)
	}
}

function parseHuffmanTables(
	bytes: Uint8Array,
	offset: number,
	length: number,
	dcTables: Set<number>,
	acTables: Set<number>,
): void {
	const end = offset + length
	while (offset < end) {
		const specification = bytes[offset]
		if (specification === undefined || offset + 17 > end) {
			throw new TypeError("JPEG Huffman table is truncated")
		}

		const tableClass = specification >>> 4
		const identifier = specification & 0x0f
		if (tableClass > 1 || identifier > 3) {
			throw new TypeError("JPEG Huffman table is invalid")
		}

		let symbols = 0
		let remainingCodes = 1
		for (let index = 1; index <= 16; index += 1) {
			const count = bytes[offset + index] as number
			symbols += count
			remainingCodes = remainingCodes * 2 - count
			if (remainingCodes < 0) {
				throw new TypeError("JPEG Huffman table is oversubscribed")
			}
		}
		if (symbols === 0 || symbols > 256) {
			throw new TypeError("JPEG Huffman table has an invalid symbol count")
		}

		const valuesOffset = offset + 17
		offset = valuesOffset + symbols
		if (offset > end) {
			throw new TypeError("JPEG Huffman table is truncated")
		}

		for (let index = 0; index < symbols; index += 1) {
			const symbol = bytes[valuesOffset + index] as number
			if (tableClass === 0 && symbol > 11) {
				throw new TypeError("JPEG DC Huffman table contains an invalid symbol")
			}
			if (
				tableClass === 1 &&
				((symbol & 0x0f) > 10 ||
					((symbol & 0x0f) === 0 && symbol !== 0x00 && symbol !== 0xf0))
			) {
				throw new TypeError("JPEG AC Huffman table contains an invalid symbol")
			}
		}

		const tables = tableClass === 0 ? dcTables : acTables
		tables.add(identifier)
	}
}

function validateScanHeader(
	bytes: Uint8Array,
	payload: number,
	length: number,
	frameComponents: ReadonlyMap<number, number> | undefined,
	quantizationTables: ReadonlySet<number>,
	dcTables: ReadonlySet<number>,
	acTables: ReadonlySet<number>,
): void {
	const componentCount = bytes[payload]
	if (
		componentCount === undefined ||
		componentCount === 0 ||
		length !== 6 + componentCount * 2 ||
		frameComponents === undefined
	) {
		throw new TypeError("JPEG scan header is invalid")
	}

	for (let index = 0; index < componentCount; index += 1) {
		const component = bytes[payload + 1 + index * 2]
		const tableSelectors = bytes[payload + 2 + index * 2]
		const quantizationTable =
			component === undefined ? undefined : frameComponents.get(component)
		if (
			component === undefined ||
			tableSelectors === undefined ||
			quantizationTable === undefined ||
			!quantizationTables.has(quantizationTable) ||
			!dcTables.has(tableSelectors >>> 4) ||
			!acTables.has(tableSelectors & 0x0f)
		) {
			throw new TypeError(
				"JPEG scan references an undefined component or table",
			)
		}
	}

	const parameters = payload + 1 + componentCount * 2
	if (
		bytes[parameters] !== 0 ||
		bytes[parameters + 1] !== 63 ||
		bytes[parameters + 2] !== 0
	) {
		throw new TypeError("JPEG scan is not baseline sequential data")
	}
}

export function createTextContent(
	owner: symbol,
	callback: (text: PdfTextBuilder) => void,
): PdfContent {
	assertOwner(owner)
	if (typeof callback !== "function") {
		throw new TypeError("A PDF text callback is required")
	}

	const operations: PdfTextOperation[] = []
	let active = true
	let hasFont = false
	let currentFont: PdfFontRecord | undefined
	let builder: PdfTextBuilder
	const use = (): void => {
		if (!active) {
			throw new Error("A PDF text builder cannot be used outside its callback")
		}
	}

	builder = Object.freeze({
		font(font: PdfFont, size: number): PdfTextBuilder {
			use()
			const record = getFontRecord(font)
			assertOwnedBy(record.owner, owner, "font")
			assertPositiveFinite(size, "PDF font size")
			operations.push(Object.freeze({ op: "font", font, size }))
			hasFont = true
			currentFont = record
			return builder
		},
		moveText(x: number, y: number): PdfTextBuilder {
			use()
			assertFiniteNumbers("PDF text position", x, y)
			operations.push(Object.freeze({ op: "moveText", x, y }))
			return builder
		},
		setTextMatrix(
			a: number,
			b: number,
			c: number,
			d: number,
			e: number,
			f: number,
		): PdfTextBuilder {
			use()
			assertFiniteNumbers("PDF text matrix", a, b, c, d, e, f)
			operations.push(
				Object.freeze({
					op: "setTextMatrix",
					a,
					b,
					c,
					d,
					e,
					f,
				}),
			)
			return builder
		},
		leading(value: number): PdfTextBuilder {
			use()
			assertFinite(value, "PDF text leading")
			operations.push(Object.freeze({ op: "leading", value }))
			return builder
		},
		nextLine(): PdfTextBuilder {
			use()
			operations.push(Object.freeze({ op: "nextLine" }))
			return builder
		},
		show(value: string | PdfLiteralString): PdfTextBuilder {
			use()
			if (!hasFont) {
				throw new Error("PDF text requires a font before text can be shown")
			}
			if (
				typeof value === "string" &&
				(currentFont?.baseFont === "Symbol" ||
					currentFont?.baseFont === "ZapfDingbats")
			) {
				throw new TypeError(
					"Symbol and ZapfDingbats text must be supplied as an encoded PDF literal string",
				)
			}

			const text =
				typeof value === "string"
					? literalString(encodeWinAnsi(value))
					: copyLiteralString(value)
			operations.push(Object.freeze({ op: "show", text }))
			return builder
		},
		characterSpacing(value: number): PdfTextBuilder {
			use()
			assertFinite(value, "PDF character spacing")
			operations.push(Object.freeze({ op: "characterSpacing", value }))
			return builder
		},
		wordSpacing(value: number): PdfTextBuilder {
			use()
			assertFinite(value, "PDF word spacing")
			operations.push(Object.freeze({ op: "wordSpacing", value }))
			return builder
		},
		horizontalScale(value: number): PdfTextBuilder {
			use()
			assertFinite(value, "PDF horizontal text scale")
			operations.push(Object.freeze({ op: "horizontalScale", value }))
			return builder
		},
		rise(value: number): PdfTextBuilder {
			use()
			assertFinite(value, "PDF text rise")
			operations.push(Object.freeze({ op: "rise", value }))
			return builder
		},
	})

	try {
		callback(builder)
	} finally {
		active = false
	}

	return createContentHandle(
		Object.freeze({
			owner,
			kind: "text",
			operations: Object.freeze([...operations]),
		}),
	)
}

export function createGraphicsContent(
	owner: symbol,
	callback: (graphics: PdfGraphicsBuilder) => void,
): PdfContent {
	assertOwner(owner)
	if (typeof callback !== "function") {
		throw new TypeError("A PDF graphics callback is required")
	}

	const operations: PdfGraphicsOperation[] = []
	let active = true
	let builder: PdfGraphicsBuilder
	const use = (): void => {
		if (!active) {
			throw new Error(
				"A PDF graphics builder cannot be used outside its callback",
			)
		}
	}

	builder = Object.freeze({
		concatMatrix(
			a: number,
			b: number,
			c: number,
			d: number,
			e: number,
			f: number,
		): PdfGraphicsBuilder {
			use()
			assertFiniteNumbers("PDF graphics matrix", a, b, c, d, e, f)
			operations.push(
				Object.freeze({
					op: "concatMatrix",
					a,
					b,
					c,
					d,
					e,
					f,
				}),
			)
			return builder
		},
		lineWidth(width: number): PdfGraphicsBuilder {
			use()
			assertFinite(width, "PDF line width")
			if (width < 0) {
				throw new RangeError("PDF line width cannot be negative")
			}

			operations.push(Object.freeze({ op: "lineWidth", width }))
			return builder
		},
		rgbFill(red: number, green: number, blue: number): PdfGraphicsBuilder {
			use()
			assertRgb(red, green, blue)
			operations.push(Object.freeze({ op: "rgbFill", red, green, blue }))
			return builder
		},
		rgbStroke(red: number, green: number, blue: number): PdfGraphicsBuilder {
			use()
			assertRgb(red, green, blue)
			operations.push(Object.freeze({ op: "rgbStroke", red, green, blue }))
			return builder
		},
		moveTo(x: number, y: number): PdfGraphicsBuilder {
			use()
			assertFiniteNumbers("PDF path position", x, y)
			operations.push(Object.freeze({ op: "moveTo", x, y }))
			return builder
		},
		lineTo(x: number, y: number): PdfGraphicsBuilder {
			use()
			assertFiniteNumbers("PDF path position", x, y)
			operations.push(Object.freeze({ op: "lineTo", x, y }))
			return builder
		},
		rectangle(
			x: number,
			y: number,
			width: number,
			height: number,
		): PdfGraphicsBuilder {
			use()
			assertFiniteNumbers("PDF rectangle", x, y, width, height)
			operations.push(
				Object.freeze({
					op: "rectangle",
					x,
					y,
					width,
					height,
				}),
			)
			return builder
		},
		closePath(): PdfGraphicsBuilder {
			use()
			operations.push(Object.freeze({ op: "closePath" }))
			return builder
		},
		stroke(): PdfGraphicsBuilder {
			use()
			operations.push(Object.freeze({ op: "stroke" }))
			return builder
		},
		fill(): PdfGraphicsBuilder {
			use()
			operations.push(Object.freeze({ op: "fill" }))
			return builder
		},
		fillAndStroke(): PdfGraphicsBuilder {
			use()
			operations.push(Object.freeze({ op: "fillAndStroke" }))
			return builder
		},
		drawImage(
			image: PdfImage,
			x: number,
			y: number,
			width: number,
			height: number,
		): PdfGraphicsBuilder {
			use()
			const record = getImageRecord(image)
			assertOwnedBy(record.owner, owner, "image")
			assertFiniteNumbers("PDF image placement", x, y)
			assertPositiveFinite(width, "PDF image display width")
			assertPositiveFinite(height, "PDF image display height")
			operations.push(
				Object.freeze({
					op: "drawImage",
					image,
					x,
					y,
					width,
					height,
				}),
			)
			return builder
		},
	})

	try {
		callback(builder)
	} finally {
		active = false
	}

	return createContentHandle(
		Object.freeze({
			owner,
			kind: "graphics",
			operations: Object.freeze([...operations]),
		}),
	)
}

export function getFontRecord(font: PdfFont): PdfFontRecord {
	const record = fontRecords.get(font)
	if (record === undefined) {
		throw new TypeError("Unknown PDF font handle")
	}

	return record
}

export function getImageRecord(image: PdfImage): PdfImageRecord {
	const record = imageRecords.get(image)
	if (record === undefined) {
		throw new TypeError("Unknown PDF image handle")
	}

	return record
}

export function getContentRecord(content: PdfContent): PdfContentRecord {
	const record = contentRecords.get(content)
	if (record === undefined) {
		throw new TypeError("Unknown PDF content handle")
	}

	return record
}

function createContentHandle(record: PdfContentRecord): PdfContent {
	const content = Object.freeze({}) as PdfContent
	contentRecords.set(content, record)
	return content
}

function encodeWinAnsi(value: string): Uint8Array {
	const bytes: number[] = []
	for (const character of value) {
		const codePoint = character.codePointAt(0)
		if (codePoint === undefined) {
			continue
		}

		if (codePoint <= 0x7f || (codePoint >= 0xa0 && codePoint <= 0xff)) {
			bytes.push(codePoint)
			continue
		}

		const byte = winAnsiSpecialCharacters.get(codePoint)
		if (byte === undefined) {
			throw new TypeError(
				`Character U+${codePoint
					.toString(16)
					.toUpperCase()
					.padStart(4, "0")} is not available in WinAnsiEncoding`,
			)
		}

		bytes.push(byte)
	}

	return Uint8Array.from(bytes)
}

function copyLiteralString(value: PdfLiteralString): PdfLiteralString {
	if (
		typeof value !== "object" ||
		value === null ||
		value.kind !== "literal-string" ||
		!(value.bytes instanceof Uint8Array)
	) {
		throw new TypeError("Expected a PDF literal string")
	}

	return literalString(value.bytes)
}

function assertOwner(owner: symbol): void {
	if (typeof owner !== "symbol") {
		throw new TypeError("A PDF builder owner must be a symbol")
	}
}

function assertOwnedBy(actual: symbol, expected: symbol, kind: string): void {
	if (actual !== expected) {
		throw new TypeError(`PDF ${kind} belongs to another document builder`)
	}
}

function assertFinite(value: number, description: string): void {
	if (!Number.isFinite(value)) {
		throw new TypeError(`${description} must be finite`)
	}
}

function assertFiniteNumbers(
	description: string,
	...values: readonly number[]
): void {
	for (const value of values) {
		assertFinite(value, description)
	}
}

function assertPositiveFinite(value: number, description: string): void {
	assertFinite(value, description)
	if (value <= 0) {
		throw new RangeError(`${description} must be greater than zero`)
	}
}

function assertRgb(red: number, green: number, blue: number): void {
	for (const value of [red, green, blue]) {
		assertFinite(value, "A PDF RGB component")
		if (value < 0 || value > 1) {
			throw new RangeError("PDF RGB components must be from 0 through 1")
		}
	}
}
