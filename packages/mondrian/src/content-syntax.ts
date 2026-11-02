// SPDX-License-Identifier: MPL-2.0

export interface ContentInstruction {
	readonly operands: readonly string[]
	readonly op: string
}

/** Tokenize content without interpreting operators inside strings or arrays. */
function* contentTokens(source: string): Generator<string> {
	let offset = 0
	const whitespace = /[\0\t\n\f\r ]/u
	const delimiter = /[\0\t\n\f\r ()<>[\]{}/%]/u
	const fail = (): never => {
		throw new TypeError(`Malformed plate content near byte ${offset}`)
	}
	const skip = (): void => {
		while (offset < source.length) {
			if (whitespace.test(source[offset]!)) offset++
			else if (source[offset] === "%") {
				while (offset < source.length && !/[\r\n]/u.test(source[offset]!))
					offset++
			} else break
		}
	}
	const token = (): string => {
		const start = offset
		const first = source[offset++]
		if (first === "(") {
			let depth = 1
			while (depth > 0 && offset < source.length) {
				const character = source[offset++]
				if (character === "\\") offset++
				else if (character === "(") depth++
				else if (character === ")") depth--
			}
			if (depth !== 0 || offset > source.length) fail()
		} else if (first === "[" || (first === "<" && source[offset] === "<")) {
			const end = first === "[" ? "]" : ">>"
			if (first === "<") offset++
			while (true) {
				skip()
				if (offset >= source.length) fail()
				if (source.startsWith(end, offset)) {
					offset += end.length
					break
				}
				token()
			}
		} else if (first === "<") {
			while (offset < source.length && source[offset] !== ">") {
				if (!/[\da-f\0\t\n\f\r ]/iu.test(source[offset]!)) fail()
				offset++
			}
			if (source[offset++] !== ">") fail()
		} else {
			if (first !== "/" && delimiter.test(first!)) fail()
			while (offset < source.length && !delimiter.test(source[offset]!))
				offset++
		}
		return source.slice(start, offset)
	}
	while (true) {
		skip()
		if (offset === source.length) break
		yield token()
	}
}

export function parsePlateContent(source: string): ContentInstruction[] {
	const result: ContentInstruction[] = []
	let operands: string[] = []
	for (const value of contentTokens(source)) {
		if (
			/^[/(<[]/u.test(value) ||
			/^[+\-.\d]/u.test(value) ||
			["true", "false", "null"].includes(value)
		)
			operands.push(value)
		else {
			result.push({ operands, op: value })
			operands = []
		}
	}
	if (operands.length > 0)
		throw new TypeError(`Malformed plate content near byte ${source.length}`)
	return result
}

/** Numeric TJ adjustments and empty strings change text state without painting. */
export function textHasGlyphs({ op, operands }: ContentInstruction): boolean {
	const operand = operands.at(-1)
	if (operand === undefined)
		throw new TypeError("Expected a text-showing operand")
	const strings = op === "TJ" ? contentTokens(operand.slice(1, -1)) : [operand]
	for (const value of strings) {
		if (value.startsWith("(")) {
			// Escaped line endings contribute no bytes; all other literal content
			// (including whitespace, nested parentheses and escaped bytes) does.
			if (!/^(?:\\(?:\r\n|\r|\n))*$/u.test(value.slice(1, -1))) return true
		} else if (value.startsWith("<") && /[\da-f]/iu.test(value.slice(1, -1)))
			return true
	}
	return false
}
