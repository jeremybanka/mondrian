import { expect, it } from "vitest"
import { parsePdf } from "../../src/index.ts"
import { isKind } from "../../src/parser/syntax.ts"
import { classic } from "../fixtures/parser.ts"

it.each(["dictionary", "stream"] as const)(
	"reads a large flat byte-name %s without the JavaScript argument limit",
	(kind) => {
		const count = 130_000
		const entries = Array.from(
			{ length: count },
			(_, index) => `/#ff${index} ${index}`,
		).join(" ")
		const body =
			kind === "dictionary"
				? `<< ${entries} >>`
				: `<< ${entries} /Length 3 >>\nstream\n\x00\x80\xff\nendstream`
		const source = classic(
			[
				[1, 0, "<< /Type /Catalog /Extra 2 0 R >>"],
				[2, 0, body],
			],
			"/Root 1 0 R",
		)
		const value = parsePdf(source).objects.find(
			(object) => object.objectNumber === 2,
		)!.value
		expect(value).toMatchObject({ kind })
		if (!isKind(value, "dictionary") && !isKind(value, "stream"))
			throw new Error("Expected a dictionary or stream")
		expect(value.byteEntries).toHaveLength(count)
		for (const index of [0, count / 2, count - 1]) {
			expect(value.byteEntries![index]).toEqual([
				{
					kind: "byte-name",
					bytes: Uint8Array.from([255, ...Buffer.from(String(index))]),
				},
				index,
			])
			expect(Object.isFrozen(value.byteEntries![index])).toBe(true)
		}
		expect(Object.isFrozen(value)).toBe(true)
		expect(Object.isFrozen(value.entries)).toBe(true)
		expect(Object.isFrozen(value.byteEntries)).toBe(true)
		if (isKind(value, "stream")) {
			expect(value.data).toEqual(Uint8Array.of(0, 128, 255))
			expect(value.entries).not.toHaveProperty("Length")
		}
	},
	20_000,
)
