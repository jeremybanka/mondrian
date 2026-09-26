import { expect, it } from "vitest"
import {
	parsePdf,
	reference,
	serializePdf,
	validatePdf,
} from "../../src/index.ts"
import { classic } from "../fixtures/parser.ts"
import type { PdfInfoDictionary } from "../../src/index.ts"

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

function withInfo(fields: string, extra: [number, number, string][] = []) {
	return {
		...withContents("[]", [[4, 0, `<< ${fields} >>`], ...extra]),
		info: reference<PdfInfoDictionary>(4),
	}
}

it("resolves indirect Info strings and Trapped names without changing their references", () => {
	const document = withInfo("/Title 5 2 R /CreationDate 6 0 R /Trapped 7 0 R", [
		[5, 2, "(Indirect title)"],
		[6, 0, "(D:20260926120000Z)"],
		[7, 0, "/False"],
	])
	expect(validatePdf(document).filter((d) => d.severity === "error")).toEqual(
		[],
	)
	expect(parsePdf(serializePdf(document))).toEqual(document)
})

it.each([
	["/Title 5 0 R", "42", "invalid-info"],
	["/CreationDate 5 0 R", "(not a date)", "invalid-info"],
	["/Trapped 5 0 R", "/Maybe", "invalid-info"],
	["/Title 9 0 R", "(text)", "invalid-reference"],
	["/Title 5 1 R", "(text)", "reference-generation-mismatch"],
])("validates the resolved Info value %s", (field, body, code) => {
	const document = withInfo(field, [[5, 0, body]])
	expect(validatePdf(document)).toContainEqual(
		expect.objectContaining({ code }),
	)
	expect(() => serializePdf(document)).toThrow()
})
