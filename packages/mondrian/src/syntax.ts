import type {
	PdfDictionaryEntries,
	PdfLiteralString,
	PdfName,
} from "./objects.ts"

const nameDelimiters = new Set([
	0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25, 0x23,
])

export function formatPdfNumber(value: number): string {
	if (!Number.isFinite(value)) {
		throw new TypeError("PDF numbers must be finite")
	}

	if (Object.is(value, -0)) {
		return "0"
	}

	const source = String(value)
	if (!source.includes("e") && !source.includes("E")) {
		return source
	}

	const match = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(source)
	if (match === null) {
		throw new TypeError(`Cannot encode PDF number: ${source}`)
	}

	const sign = match[1] ?? ""
	const integer = match[2] ?? ""
	const fraction = match[3] ?? ""
	const exponent = Number(match[4])
	const digits = `${integer}${fraction}`
	const decimalIndex = integer.length + exponent

	if (decimalIndex <= 0) {
		return `${sign}0.${"0".repeat(-decimalIndex)}${digits}`
	}

	if (decimalIndex >= digits.length) {
		return `${sign}${digits}${"0".repeat(decimalIndex - digits.length)}`
	}

	return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`
}

export function encodePdfName(value: string): string {
	return encodePdfNameBytes(utf8(value))
}

export function encodePdfNameBytes(bytes: Uint8Array): string {
	let result = "/"

	for (const byte of bytes) {
		if (byte >= 0x21 && byte <= 0x7e && !nameDelimiters.has(byte)) {
			result += String.fromCharCode(byte)
		} else {
			result += `#${byte.toString(16).toUpperCase().padStart(2, "0")}`
		}
	}

	return result
}

export function encodePdfLiteralString(value: PdfLiteralString): string {
	let result = "("

	for (const byte of value.bytes) {
		switch (byte) {
			case 0x08:
				result += "\\b"
				break
			case 0x09:
				result += "\\t"
				break
			case 0x0a:
				result += "\\n"
				break
			case 0x0c:
				result += "\\f"
				break
			case 0x0d:
				result += "\\r"
				break
			case 0x28:
				result += "\\("
				break
			case 0x29:
				result += "\\)"
				break
			case 0x5c:
				result += "\\\\"
				break
			default:
				if (byte < 0x20 || byte > 0x7e) {
					result += `\\${byte.toString(8).padStart(3, "0")}`
				} else {
					result += String.fromCharCode(byte)
				}
		}
	}

	return `${result})`
}

export function encodePdfHexString(bytes: Uint8Array): string {
	let result = "<"
	for (const byte of bytes) {
		result += byte.toString(16).toUpperCase().padStart(2, "0")
	}

	return `${result}>`
}

export function assertDictionaryKeys(entries: PdfDictionaryEntries): void {
	for (const key of Object.keys(entries)) {
		if (key.length === 0) {
			throw new TypeError("A PDF dictionary key cannot be empty")
		}

		if (key.includes("\0")) {
			throw new TypeError("A PDF dictionary key cannot contain NUL")
		}
	}
}

export function isPdfName<TName extends string>(
	value: unknown,
	name?: TName,
): value is PdfName<TName> {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { readonly kind?: unknown }).kind === "name" &&
		(name === undefined ||
			(value as { readonly value?: unknown }).value === name)
	)
}

function utf8(value: string): Uint8Array {
	const bytes: number[] = []

	for (let index = 0; index < value.length; index += 1) {
		const first = value.charCodeAt(index)
		let codePoint = first

		if (first >= 0xd800 && first <= 0xdbff) {
			const second = value.charCodeAt(index + 1)
			if (index + 1 >= value.length || second < 0xdc00 || second > 0xdfff) {
				throw new TypeError("A PDF name cannot contain an unpaired surrogate")
			}

			codePoint = 0x10_000 + ((first - 0xd800) << 10) + (second - 0xdc00)
			index += 1
		} else if (first >= 0xdc00 && first <= 0xdfff) {
			throw new TypeError("A PDF name cannot contain an unpaired surrogate")
		}

		if (codePoint <= 0x7f) {
			bytes.push(codePoint)
		} else if (codePoint <= 0x7ff) {
			bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f))
		} else if (codePoint <= 0xffff) {
			bytes.push(
				0xe0 | (codePoint >>> 12),
				0x80 | ((codePoint >>> 6) & 0x3f),
				0x80 | (codePoint & 0x3f),
			)
		} else {
			bytes.push(
				0xf0 | (codePoint >>> 18),
				0x80 | ((codePoint >>> 12) & 0x3f),
				0x80 | ((codePoint >>> 6) & 0x3f),
				0x80 | (codePoint & 0x3f),
			)
		}
	}

	return Uint8Array.from(bytes)
}
