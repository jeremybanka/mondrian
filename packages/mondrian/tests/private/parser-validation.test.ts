import { expect, it } from "vitest"
import { parsePdf, serializePdf, validatePdf } from "../../src/index.ts"
import { classic } from "../fixtures/parser.ts"

function withContents(contents: string, extra: [number, number, string][]) {
	return parsePdf(
		classic(
			[
				[1, 0, "<< /Type /Catalog /Pages 2 0 R >>"],
				[2, 0, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"],
				[
					3,
					0,
					`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents ${contents} >>`,
				],
				...extra,
			],
			"/Root 1 0 R",
		),
	)
}

it.each(["[]", "[5 0 R]"])(
	"roundtrips an indirect Contents array %s",
	(body) => {
		const document = withContents("4 0 R", [
			[4, 0, body],
			[5, 0, "<< /Length 0 >>\nstream\n\nendstream"],
		])
		expect(validatePdf(document).filter((d) => d.severity === "error")).toEqual(
			[],
		)
		expect(parsePdf(serializePdf(document))).toEqual(document)
	},
)

it.each([
	["[42]", "invalid-page-tree"],
	["[5 0 R]", "incorrect-reference-target"],
	["[9 0 R]", "invalid-reference"],
	["[5 1 R]", "reference-generation-mismatch"],
])("still validates members of indirect Contents %s", (body, code) => {
	const document = withContents("4 0 R", [
		[4, 0, body],
		[5, 0, "42"],
	])
	expect(validatePdf(document)).toContainEqual(
		expect.objectContaining({ code }),
	)
	expect(() => serializePdf(document)).toThrow()
})
