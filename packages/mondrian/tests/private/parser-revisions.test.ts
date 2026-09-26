import { expect, it } from "vitest"
import { parsePdf, serializePdf, validatePdf } from "../../src/index.ts"
import { readPdf } from "../../src/testing/inspection/read-pdf.ts"
import { binaryText } from "../../src/parser/syntax.ts"

it.each(["delete-info", "replace-catalog"] as const)(
	"reserializes incremental %s without historical trailer references",
	async (change) => {
		const source = revisedPdf(change)
		const expected = await readPdf(Buffer.from(source, "latin1"))
		const document = parsePdf(source)
		expect(
			validatePdf(document).filter(
				(diagnostic) => diagnostic.severity === "error",
			),
		).toEqual([])
		expect(document.objects.map((object) => object.objectNumber)).not.toContain(
			5,
		)
		expect(document.info).toBeUndefined()
		const actual = await readPdf(serializePdf(document))
		expect(actual.pages).toEqual(expected.pages)
		expect(actual.title).toBe("")
	},
)

it("keeps a current ordinary object that reuses an old cross-reference stream number", () => {
	const document = parsePdf(revisedPdf("reuse-number"))
	expect(
		document.objects.find((object) => object.objectNumber === 5),
	).toMatchObject({
		generation: 1,
		value: {
			kind: "literal-string",
			bytes: Uint8Array.from(Buffer.from("current")),
		},
	})
	expect(() => serializePdf(document)).not.toThrow()
})

function revisedPdf(
	change: "delete-info" | "replace-catalog" | "reuse-number",
): string {
	let source = "%PDF-1.7\n"
	const offsets = new Map<number, number>()
	const add = (number: number, body: string) => {
		offsets.set(number, source.length)
		source += `${number} 0 obj\n${body}\nendobj\n`
	}
	add(1, "<< /Type /Catalog /Pages 2 0 R >>")
	add(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
	add(
		3,
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> >>",
	)
	add(4, "<< /Title (old metadata) >>")
	const previous = source.length
	offsets.set(5, previous)
	const records = new Uint8Array(6 * 7)
	for (let number = 0; number < 6; number++) {
		records[number * 7] = number === 0 ? 0 : 1
		new DataView(records.buffer).setUint32(
			number * 7 + 1,
			offsets.get(number) ?? 0,
		)
		new DataView(records.buffer).setUint16(
			number * 7 + 5,
			number === 0 ? 65535 : 0,
		)
	}
	add(
		5,
		`<< /Type /XRef /Root 1 0 R /Info 4 0 R /Size 6 /W [1 4 2] /Length ${records.length} >>\nstream\n${binaryText(records)}\nendstream`,
	)
	source += `startxref\n${previous}\n%%EOF\n`
	const addedOffset = source.length
	if (change === "replace-catalog") add(6, "<< /Type /Catalog /Pages 2 0 R >>")
	if (change === "reuse-number") source += "5 1 obj\n(current)\nendobj\n"
	const xref = source.length
	source += `xref\n0 1\n${change === "replace-catalog" ? "0000000001" : "0000000004"} 65535 f \n4 1\n0000000000 00001 f \n`
	if (change === "replace-catalog")
		source += `1 1\n0000000004 00001 f \n6 1\n${String(addedOffset).padStart(10, "0")} 00000 n \n`
	if (change === "reuse-number")
		source += `5 1\n${String(addedOffset).padStart(10, "0")} 00001 n \n`
	return (
		source +
		`trailer\n<< /Size ${change === "replace-catalog" ? 7 : 6} /Root ${change === "replace-catalog" ? 6 : 1} 0 R /Info null /Prev ${previous} >>\nstartxref\n${xref}\n%%EOF\n`
	)
}
