// SPDX-License-Identifier: MPL-2.0

/* eslint-disable no-control-regex -- NUL is PDF whitespace. */

import type {
	PdfAnyName,
	PdfDictionary,
	PdfDictionaryByteEntry,
	PdfIndirectObject,
	PdfIndirectValue,
	PdfValue,
} from "../objects.ts"
import {
	dictionary,
	hexString,
	indirectObject,
	literalString,
	reference,
	stream,
} from "../objects.ts"
import { PdfParseError } from "./error.ts"

const whitespace = /[\x00\t\n\f\r ]/
// Braces delimit Type 4 calculator functions, not ordinary PDF objects.
const delimiter = /[\x00\t\n\f\r ()<>[\]/%]/
let utf8: TextDecoder | undefined

export function binaryText(bytes: Uint8Array): string {
	let result = ""
	for (let index = 0; index < bytes.length; index += 8192) {
		result += String.fromCharCode(...bytes.subarray(index, index + 8192))
	}
	return result
}

export function binaryBytes(text: string): Uint8Array {
	return Uint8Array.from(text, (character) => character.charCodeAt(0))
}

export function isKind<
	T extends Exclude<
		PdfIndirectValue | PdfValue,
		null | boolean | number
	>["kind"],
>(
	value: PdfIndirectValue | PdfValue | undefined,
	kind: T,
): value is Extract<PdfIndirectValue | PdfValue, { kind: T }> {
	return typeof value === "object" && value !== null && value.kind === kind
}

/** Byte-oriented PDF token reader. Offsets in decoded object streams use their container's file offset. */
export class SyntaxReader {
	readonly source: string
	position: number
	readonly containerOffset: number | undefined

	constructor(source: string, position = 0, containerOffset?: number) {
		this.source = source
		this.position = position
		this.containerOffset = containerOffset
	}

	fail(message: string): never {
		throw new PdfParseError(message, this.containerOffset ?? this.position)
	}

	skip(): void {
		while (this.position < this.source.length) {
			const character = this.source[this.position]!
			if (whitespace.test(character)) this.position++
			else if (character === "%") {
				while (
					this.position < this.source.length &&
					!/[\r\n]/.test(this.source[this.position]!)
				)
					this.position++
			} else break
		}
	}

	take(token: string): boolean {
		this.skip()
		if (!this.source.startsWith(token, this.position)) return false
		const next = this.source[this.position + token.length]
		if (/^[a-z]/i.test(token) && next !== undefined && !delimiter.test(next))
			return false
		this.position += token.length
		return true
	}

	expect(token: string): void {
		if (!this.take(token)) this.fail(`Expected ${token}`)
	}

	integer(description: string): number {
		this.skip()
		const match = /^\d+/.exec(this.source.slice(this.position))
		if (match === null) this.fail(`Expected ${description}`)
		this.position += match[0].length
		const next = this.source[this.position]
		const value = Number(match[0])
		if (
			!Number.isSafeInteger(value) ||
			(next !== undefined && !delimiter.test(next))
		)
			this.fail(`Invalid ${description}`)
		return value
	}

	value(depth = 0): PdfValue {
		this.skip()
		if (depth > 256) this.fail("PDF object nesting exceeds 256 levels")
		const character = this.source[this.position]
		if (character === "/") return this.name()
		if (character === "(") return this.literal()
		if (this.take("<<")) return this.dictionary(depth)
		if (this.take("<")) return this.hex()
		if (this.take("[")) {
			const items: PdfValue[] = []
			while (!this.take("]")) items.push(this.value(depth + 1))
			return Object.freeze({ kind: "array", items: Object.freeze(items) })
		}
		if (this.take("true")) return true
		if (this.take("false")) return false
		if (this.take("null")) return null
		const match = /^[+-]?(?:\d+\.?\d*|\.\d+)/.exec(
			this.source.slice(this.position),
		)
		if (match === null) this.fail("Expected a PDF value")
		this.position += match[0].length
		const next = this.source[this.position]
		const number = Number(match[0])
		if (
			!Number.isFinite(number) ||
			(next !== undefined && !delimiter.test(next))
		)
			this.fail("Invalid PDF number")
		const afterNumber = this.position
		if (/^\d+$/.test(match[0])) {
			this.skip()
			const generation = /^(\d+)(?=[\x00\t\n\f\r %])/.exec(
				this.source.slice(this.position),
			)
			if (generation !== null) {
				this.position += generation[1]!.length
				if (this.take("R")) {
					if (
						number < 1 ||
						number > 9_999_999_999 ||
						Number(generation[1]) > 65_534
					)
						this.fail("Invalid indirect reference")
					return reference(number, Number(generation[1]))
				}
			}
		}
		this.position = afterNumber
		return number
	}

	indirect(
		resolve: (value: PdfValue | undefined) => PdfIndirectValue | undefined,
	): PdfIndirectObject {
		const number = this.integer("object number")
		const generation = this.integer("generation number")
		if (number < 1 || number > 9_999_999_999 || generation > 65_534)
			this.fail("Invalid indirect object header")
		this.expect("obj")
		let value: PdfIndirectValue | PdfValue = this.value()
		if (isKind(value, "reference"))
			this.fail("An indirect object cannot contain only a reference")
		if (isKind(value, "dictionary") && this.take("stream")) {
			// Only LF and CRLF are permitted after the stream keyword.
			if (this.source[this.position] === "\r") this.position++
			if (this.source[this.position++] !== "\n")
				this.fail("Expected a line feed after stream")
			const length = resolve(value.entries.Length)
			if (
				typeof length !== "number" ||
				!Number.isSafeInteger(length) ||
				length < 0
			)
				this.fail("Stream Length must resolve to a non-negative integer")
			const end = this.position + length
			if (end > this.source.length)
				this.fail("Stream data extends beyond the input")
			const data = binaryBytes(this.source.slice(this.position, end))
			this.position = end
			this.expect("endstream")
			const { Length: _length, ...entries } = value.entries
			value = stream(entries, data, ...(value.byteEntries ?? []))
		}
		this.expect("endobj")
		return indirectObject(number, value, generation)
	}

	private name(): PdfAnyName {
		this.position++
		const bytes: number[] = []
		while (
			this.position < this.source.length &&
			!delimiter.test(this.source[this.position]!)
		) {
			let byte = this.source.charCodeAt(this.position++)
			if (byte === 35) {
				const hex = this.source.slice(this.position, this.position + 2)
				if (!/^[\da-f]{2}$/i.test(hex)) this.fail("Invalid PDF name escape")
				byte = Number.parseInt(hex, 16)
				this.position += 2
			}
			if (byte === 0) this.fail("A PDF name cannot contain NUL")
			bytes.push(byte)
		}
		const data = Uint8Array.from(bytes)
		try {
			utf8 ??= new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
			return Object.freeze({ kind: "name", value: utf8.decode(data) })
		} catch {
			return Object.freeze({ kind: "byte-name", bytes: data })
		}
	}

	private dictionary(depth: number): PdfDictionary {
		const entries: Record<string, PdfValue> = Object.create(null)
		const byteEntries: PdfDictionaryByteEntry[] = []
		const keys = new Set<string>()
		while (!this.take(">>")) {
			if (this.source[this.position] !== "/")
				this.fail("Expected a dictionary key")
			const key = this.name()
			const bytes =
				key.kind === "name" ? new TextEncoder().encode(key.value) : key.bytes
			const identity = binaryText(bytes)
			if (keys.has(identity)) this.fail("Duplicate dictionary key")
			keys.add(identity)
			const value = this.value(depth + 1)
			if (key.kind === "name") entries[key.value] = value
			else byteEntries.push([key, value])
		}
		return dictionary(entries, ...byteEntries)
	}

	private literal() {
		this.position++
		let depth = 1
		const bytes: number[] = []
		while (this.position < this.source.length) {
			let byte = this.source.charCodeAt(this.position++)
			if (byte === 92) {
				if (this.position === this.source.length) break
				byte = this.source.charCodeAt(this.position++)
				const escapes: Record<number, number> = {
					110: 10,
					114: 13,
					116: 9,
					98: 8,
					102: 12,
				}
				if (byte === 13 || byte === 10) {
					if (byte === 13 && this.source[this.position] === "\n")
						this.position++
					continue
				}
				if (byte >= 48 && byte <= 55) {
					let octal = String.fromCharCode(byte)
					for (
						let count = 1;
						count < 3 && /[0-7]/.test(this.source[this.position] ?? "");
						count++
					)
						octal += this.source[this.position++]
					byte = Number.parseInt(octal, 8) & 255
				} else byte = escapes[byte] ?? byte
			} else if (byte === 40) depth++
			else if (byte === 41) {
				if (--depth === 0) return literalString(Uint8Array.from(bytes))
			} else if (byte === 13) {
				if (this.source[this.position] === "\n") this.position++
				byte = 10
			}
			bytes.push(byte)
		}
		return this.fail("Unterminated literal string")
	}

	private hex() {
		let digits = ""
		while (this.position < this.source.length) {
			const character = this.source[this.position++]!
			if (character === ">") {
				if (digits.length % 2) digits += "0"
				const bytes = new Uint8Array(digits.length / 2)
				for (let index = 0; index < bytes.length; index++)
					bytes[index] = Number.parseInt(
						digits.slice(index * 2, index * 2 + 2),
						16,
					)
				return hexString(bytes)
			}
			if (whitespace.test(character)) continue
			if (!/[\da-f]/i.test(character)) this.fail("Invalid hexadecimal string")
			digits += character
		}
		return this.fail("Unterminated hexadecimal string")
	}
}
