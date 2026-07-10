declare const objectNumberBrand: unique symbol
declare const generationNumberBrand: unique symbol
declare const textStringBrand: unique symbol
declare const dateStringBrand: unique symbol

export type PdfObjectNumber = number & {
	readonly [objectNumberBrand]: "PdfObjectNumber"
}

export type PdfGenerationNumber = number & {
	readonly [generationNumberBrand]: "PdfGenerationNumber"
}

export type PdfVersion =
	| "1.0"
	| "1.1"
	| "1.2"
	| "1.3"
	| "1.4"
	| "1.5"
	| "1.6"
	| "1.7"
	| "2.0"

export interface PdfName<TValue extends string = string> {
	readonly kind: "name"
	readonly value: TValue
}

export interface PdfByteName {
	readonly kind: "byte-name"
	readonly bytes: Uint8Array
}

export type PdfAnyName = PdfName | PdfByteName

export interface PdfLiteralString {
	readonly kind: "literal-string"
	readonly bytes: Uint8Array
}

export interface PdfHexString {
	readonly kind: "hex-string"
	readonly bytes: Uint8Array
}

export type PdfTextString = (PdfLiteralString | PdfHexString) & {
	readonly [textStringBrand]: "PdfTextString"
}

export type PdfDateString = PdfLiteralString & {
	readonly [dateStringBrand]: "PdfDateString"
}

export interface PdfReference<
	TTarget extends PdfIndirectValue = PdfIndirectValue,
> {
	readonly kind: "reference"
	readonly objectNumber: PdfObjectNumber
	readonly generation: PdfGenerationNumber

	/** Compile-time-only target information. */
	readonly __target?: TTarget
}

export interface PdfArray<
	TItems extends readonly PdfValue[] = readonly PdfValue[],
> {
	readonly kind: "array"
	readonly items: TItems
}

export type PdfDictionaryEntries = Readonly<
	Record<string, PdfValue | undefined>
>

export type PdfDictionaryByteEntry<
	TKey extends PdfAnyName = PdfAnyName,
	TValue extends PdfValue = PdfValue,
> = readonly [key: TKey, value: TValue]

export interface PdfDictionary<
	TEntries extends PdfDictionaryEntries = PdfDictionaryEntries,
	TByteEntries extends readonly PdfDictionaryByteEntry[] =
		readonly PdfDictionaryByteEntry[],
> {
	readonly kind: "dictionary"
	readonly entries: TEntries
	readonly byteEntries?: TByteEntries
}

export type PdfStreamEntries = PdfDictionaryEntries & {
	readonly Length?: never
}

export interface PdfStream<
	TEntries extends PdfStreamEntries = PdfStreamEntries,
	TByteEntries extends readonly PdfDictionaryByteEntry[] =
		readonly PdfDictionaryByteEntry[],
> {
	readonly kind: "stream"
	readonly entries: TEntries
	readonly byteEntries?: TByteEntries
	readonly data: Uint8Array
}

export type PdfDirectObject =
	| null
	| boolean
	| number
	| PdfName
	| PdfByteName
	| PdfLiteralString
	| PdfHexString
	| PdfArray
	| PdfDictionary

export type PdfValue = PdfDirectObject | PdfReference

/** A value that may appear between `obj` and `endobj`. */
export type PdfIndirectValue = PdfDirectObject | PdfStream

export interface PdfIndirectObject<
	TValue extends PdfIndirectValue = PdfIndirectValue,
> {
	readonly objectNumber: PdfObjectNumber
	readonly generation: PdfGenerationNumber
	readonly value: TValue
}

export interface PdfCatalogEntries extends PdfDictionaryEntries {
	readonly Type: PdfName<"Catalog">
	readonly Pages: PdfReference<PdfPagesDictionary>
}

export interface PdfCatalogDictionary extends PdfDictionary<PdfCatalogEntries> {}

export interface PdfPagesEntries extends PdfDictionaryEntries {
	readonly Type: PdfName<"Pages">
	readonly Kids: PdfArray<
		readonly PdfReference<PdfPageDictionary | PdfPagesDictionary>[]
	>
	readonly Count: number
	readonly Parent?: PdfReference<PdfPagesDictionary>
	readonly MediaBox?: PdfArray<readonly [number, number, number, number]>
	readonly Resources?: PdfDictionary | PdfReference<PdfDictionary>
	readonly Rotate?: number
}

export interface PdfPagesDictionary extends PdfDictionary<PdfPagesEntries> {}

export interface PdfPageEntries extends PdfDictionaryEntries {
	readonly Type: PdfName<"Page">
	readonly Parent: PdfReference<PdfPagesDictionary>
	readonly MediaBox?: PdfArray<readonly [number, number, number, number]>
	readonly Resources?: PdfDictionary | PdfReference<PdfDictionary>
	readonly Contents?:
		| PdfReference<PdfStream>
		| PdfArray<readonly PdfReference<PdfStream>[]>
	readonly Rotate?: number
}

export interface PdfPageDictionary extends PdfDictionary<PdfPageEntries> {}

export interface PdfInfoEntries extends PdfDictionaryEntries {
	readonly Title?: PdfTextString
	readonly Author?: PdfTextString
	readonly Subject?: PdfTextString
	readonly Keywords?: PdfTextString
	readonly Creator?: PdfTextString
	readonly Producer?: PdfTextString
	readonly CreationDate?: PdfDateString
	readonly ModDate?: PdfDateString
	readonly Trapped?: PdfName<"True" | "False" | "Unknown">
}

export interface PdfInfoDictionary extends PdfDictionary<PdfInfoEntries> {}

export interface PdfDocument {
	readonly version: PdfVersion
	readonly root: PdfReference<PdfCatalogDictionary>
	readonly objects: readonly PdfIndirectObject[]
	readonly info?: PdfReference<PdfInfoDictionary>
	readonly id?: readonly [PdfHexString, PdfHexString]
}

export function objectNumber(value: number): PdfObjectNumber {
	if (!Number.isSafeInteger(value) || value <= 0 || value > 9_999_999_999) {
		throw new RangeError(
			"A PDF object number must be an integer from 1 through 9999999999",
		)
	}

	return value as PdfObjectNumber
}

export function generationNumber(value = 0): PdfGenerationNumber {
	if (!Number.isInteger(value) || value < 0 || value > 65_534) {
		throw new RangeError(
			"A PDF generation number must be an integer from 0 through 65534",
		)
	}

	return value as PdfGenerationNumber
}

export function name<const TValue extends string>(
	value: TValue,
): PdfName<TValue> {
	if (value.length === 0) {
		throw new TypeError("A PDF name cannot be empty")
	}

	if (value.includes("\0")) {
		throw new TypeError("A PDF name cannot contain NUL")
	}
	assertWellFormedUnicode(value, "A PDF name")

	return Object.freeze({ kind: "name", value })
}

export function nameBytes(bytes: Uint8Array): PdfByteName {
	if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
		throw new TypeError("A PDF byte name must contain at least one byte")
	}

	if (bytes.includes(0)) {
		throw new TypeError("A PDF name cannot contain NUL")
	}

	return Object.freeze({ kind: "byte-name", bytes: bytes.slice() })
}

export function literalString(bytes: Uint8Array): PdfLiteralString {
	return Object.freeze({
		kind: "literal-string",
		bytes: bytes.slice(),
	})
}

export function hexString(bytes: Uint8Array): PdfHexString {
	return Object.freeze({
		kind: "hex-string",
		bytes: bytes.slice(),
	})
}

export function textString(value: string): PdfTextString {
	const bytes = new Uint8Array(2 + value.length * 2)
	bytes[0] = 0xfe
	bytes[1] = 0xff

	for (let index = 0; index < value.length; index += 1) {
		const codeUnit = value.charCodeAt(index)

		if (
			(codeUnit >= 0xd800 &&
				codeUnit <= 0xdbff &&
				(index + 1 >= value.length ||
					value.charCodeAt(index + 1) < 0xdc00 ||
					value.charCodeAt(index + 1) > 0xdfff)) ||
			(codeUnit >= 0xdc00 &&
				codeUnit <= 0xdfff &&
				(index === 0 ||
					value.charCodeAt(index - 1) < 0xd800 ||
					value.charCodeAt(index - 1) > 0xdbff))
		) {
			throw new TypeError(
				"A PDF text string cannot contain an unpaired surrogate",
			)
		}

		bytes[2 + index * 2] = codeUnit >>> 8
		bytes[3 + index * 2] = codeUnit & 0xff
	}

	return hexString(bytes) as PdfTextString
}

export function asciiTextString(value: string): PdfTextString {
	return literalString(ascii(value)) as PdfTextString
}

export function dateString(value: Date): PdfDateString {
	if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
		throw new TypeError("A PDF date string requires a valid Date")
	}

	const year = value.getUTCFullYear()
	if (year < 0 || year > 9_999) {
		throw new RangeError("A PDF date year must fit four digits")
	}

	const component = (number: number, width: number): string =>
		number.toString().padStart(width, "0")
	const formatted = `D:${component(year, 4)}${component(
		value.getUTCMonth() + 1,
		2,
	)}${component(value.getUTCDate(), 2)}${component(
		value.getUTCHours(),
		2,
	)}${component(value.getUTCMinutes(), 2)}${component(
		value.getUTCSeconds(),
		2,
	)}Z`
	return literalString(ascii(formatted)) as PdfDateString
}

export function array<const TItems extends readonly PdfValue[]>(
	...items: TItems
): PdfArray<TItems> {
	return Object.freeze({
		kind: "array",
		items: Object.freeze([...items]) as unknown as TItems,
	})
}

export function dictionary<
	const TEntries extends PdfDictionaryEntries,
	const TByteEntries extends readonly PdfDictionaryByteEntry[],
>(
	entries: TEntries,
	...byteEntries: TByteEntries
): PdfDictionary<TEntries, TByteEntries> {
	const copiedEntries = copyEntries(entries)
	return Object.freeze({
		kind: "dictionary",
		entries: Object.freeze(copiedEntries) as TEntries,
		...(byteEntries.length === 0
			? {}
			: { byteEntries: copyByteEntries(byteEntries) }),
	})
}

export function stream<
	const TEntries extends PdfStreamEntries,
	const TByteEntries extends readonly PdfDictionaryByteEntry[],
>(
	entries: TEntries,
	data: Uint8Array,
	...byteEntries: TByteEntries
): PdfStream<TEntries, TByteEntries> {
	if (Object.hasOwn(entries, "Length")) {
		throw new TypeError("Stream Length is derived during serialization")
	}
	if (
		byteEntries.some(([key]) =>
			key.kind === "name"
				? key.value === "Length"
				: isAsciiBytes(key.bytes, "Length"),
		)
	) {
		throw new TypeError("Stream Length is derived during serialization")
	}

	const copiedEntries = copyEntries(entries)
	return Object.freeze({
		kind: "stream",
		entries: Object.freeze(copiedEntries) as TEntries,
		...(byteEntries.length === 0
			? {}
			: { byteEntries: copyByteEntries(byteEntries) }),
		data: data.slice(),
	})
}

export function dictionaryEntry<
	const TKey extends PdfAnyName,
	const TValue extends PdfValue,
>(key: TKey, value: TValue): PdfDictionaryByteEntry<TKey, TValue> {
	return Object.freeze([key, value])
}

export function reference<TTarget extends PdfIndirectValue = PdfIndirectValue>(
	value: number | PdfObjectNumber,
	generation: number | PdfGenerationNumber = 0,
): PdfReference<TTarget> {
	return Object.freeze({
		kind: "reference",
		objectNumber: objectNumber(value),
		generation: generationNumber(generation),
	})
}

export function indirectObject<TValue extends PdfIndirectValue>(
	value: number | PdfObjectNumber,
	object: TValue,
	generation: number | PdfGenerationNumber = 0,
): PdfIndirectObject<TValue> {
	return Object.freeze({
		objectNumber: objectNumber(value),
		generation: generationNumber(generation),
		value: object,
	})
}

export function ascii(value: string): Uint8Array {
	const bytes = new Uint8Array(value.length)

	for (let index = 0; index < value.length; index += 1) {
		const codeUnit = value.charCodeAt(index)
		if (codeUnit > 0x7f) {
			throw new TypeError("Expected ASCII text")
		}

		bytes[index] = codeUnit
	}

	return bytes
}

function copyEntries<TEntries extends PdfDictionaryEntries>(
	entries: TEntries,
): PdfDictionaryEntries {
	const result: Record<string, PdfValue | undefined> = Object.create(null)
	for (const [key, value] of Object.entries(entries)) {
		result[key] = value
	}

	return result
}

function copyByteEntries<TEntries extends readonly PdfDictionaryByteEntry[]>(
	entries: TEntries,
): TEntries {
	return Object.freeze(
		entries.map(([key, value]) => Object.freeze([key, value])),
	) as unknown as TEntries
}

function isAsciiBytes(bytes: Uint8Array, value: string): boolean {
	return (
		bytes.length === value.length &&
		bytes.every((byte, index) => byte === value.charCodeAt(index))
	)
}

function assertWellFormedUnicode(value: string, description: string): void {
	for (let index = 0; index < value.length; index += 1) {
		const codeUnit = value.charCodeAt(index)
		if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
			const next = value.charCodeAt(index + 1)
			if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
				throw new TypeError(
					`${description} cannot contain an unpaired surrogate`,
				)
			}
			index += 1
		} else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
			throw new TypeError(`${description} cannot contain an unpaired surrogate`)
		}
	}
}
