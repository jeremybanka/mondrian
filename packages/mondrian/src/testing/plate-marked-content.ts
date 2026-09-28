// SPDX-License-Identifier: MPL-2.0

import type { PdfIndirectValue, PdfValue } from "../objects.ts"
import { SyntaxReader, isKind } from "../parser/syntax.ts"
import type { ContentInstruction } from "./plate-content.ts"
import { pdfName } from "./plate-names.ts"

/** Validate metadata without interpreting it as paint or losing its original bytes. */
export class PlateMarkedContent {
	private readonly stack: ("marked" | "text")[] = []
	private readonly property: (key: string) => PdfIndirectValue | undefined

	constructor(property: (key: string) => PdfIndirectValue | undefined) {
		this.property = property
	}

	accept({ op, operands }: ContentInstruction): boolean {
		// PDF 1.6 §10.5: text and marked-content pairs must nest separately.
		if (op === "BT") {
			if (this.stack.includes("text"))
				throw new TypeError("Nested BT in plate content")
			this.stack.push("text")
			return false
		}
		if (op === "ET") {
			this.close("text")
			return false
		}
		if (op === "EMC") {
			if (operands.length !== 0) throw new TypeError("EMC takes no operands")
			this.close("marked")
			return true
		}
		if (!["BMC", "BDC", "MP", "DP"].includes(op)) return false
		const hasProperties = op === "BDC" || op === "DP"
		if (operands.length !== (hasProperties ? 2 : 1))
			throw new TypeError(`Invalid ${op} operands`)
		if (nameOperand(operands[0]!) === "/OC")
			throw new TypeError(
				"Optional-content painting is unsupported in plate previews",
			)
		if (hasProperties) {
			const operand = operands[1]!
			const inline = operand.startsWith("<<")
			const properties = inline
				? readOperand(operand)
				: this.property(nameOperand(operand))
			if (!isKind(properties, "dictionary"))
				throw new TypeError("Marked-content properties must be a dictionary")
			// Inline properties cannot refer outside the content stream (§10.5.1).
			// Named property resources may contain ordinary indirect PDF objects.
			if (inline) assertDirect(properties)
		}
		if (op === "BMC" || op === "BDC") this.stack.push("marked")
		return true
	}

	finish(): void {
		if (this.stack.length !== 0)
			throw new TypeError(
				"Unbalanced marked content or text object in plate content",
			)
	}

	private close(kind: "marked" | "text"): void {
		if (this.stack.pop() !== kind)
			throw new TypeError(
				"Unbalanced or overlapping marked content and text objects",
			)
	}
}

function readOperand(token: string): PdfValue {
	const reader = new SyntaxReader(token)
	const value = reader.value()
	reader.skip()
	if (reader.position !== token.length)
		throw new TypeError("Invalid marked-content operand")
	return value
}

function nameOperand(token: string): string {
	const value = readOperand(token)
	if (!isKind(value, "name") && !isKind(value, "byte-name"))
		throw new TypeError("Expected a marked-content name")
	return pdfName(value)!
}

function assertDirect(value: PdfValue): void {
	if (isKind(value, "reference"))
		throw new TypeError(
			"Inline marked-content properties cannot contain references",
		)
	if (isKind(value, "array")) value.items.forEach(assertDirect)
	if (isKind(value, "dictionary")) {
		for (const item of Object.values(value.entries))
			if (item !== undefined) assertDirect(item)
		for (const [, item] of value.byteEntries ?? []) assertDirect(item)
	}
}
