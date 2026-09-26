import { expect, it } from "vitest"
import { parsePdf, PdfParseError } from "../../src/index.ts"
import { SyntaxReader } from "../../src/parser/syntax.ts"
import { classic } from "../fixtures/parser.ts"

it.each([
	"9007199254740993",
	"-9007199254740993",
	"+009007199254740993",
	"9007199254740992",
	"9007199254740993.0",
])("rejects unsupported integer precision at the token offset: %s", (token) => {
	const source = classic(
		[
			[1, 0, "<< /Type /Catalog /Extra 2 0 R >>"],
			[2, 0, token],
		],
		"/Root 1 0 R",
	)
	const offset = source.indexOf(`\n${token}\n`) + 1
	expect(() => parsePdf(source)).toThrow(
		new PdfParseError("PDF integer exceeds safe integer precision", offset),
	)
})

it.each([
	["9007199254740991", Number.MAX_SAFE_INTEGER],
	["-9007199254740991", Number.MIN_SAFE_INTEGER],
	["+00017", 17],
	["-0", -0],
	[".125", 0.125],
	["1.", 1],
])("preserves supported number %s", (token, expected) => {
	const source = classic(
		[
			[1, 0, "<< /Type /Catalog /Extra 2 0 R >>"],
			[2, 0, token],
		],
		"/Root 1 0 R",
	)
	expect(parsePdf(source).objects[1]!.value).toBe(expected)
})

it("reports the container offset for an unsafe integer in decoded object data", () => {
	expect(() => new SyntaxReader("[9007199254740993]", 0, 137).value()).toThrow(
		new PdfParseError("PDF integer exceeds safe integer precision", 137),
	)
})
