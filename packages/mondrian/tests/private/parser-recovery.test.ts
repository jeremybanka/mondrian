import { expect, it } from "vitest"
import { parsePdf, PdfParseError, serializePdf } from "../../src/index.ts"
import { classic } from "../fixtures/parser.ts"

const source = classic(
	[
		[1, 0, "<< /Type /Catalog /Pages 2 0 R >>"],
		[2, 0, "<< /Type /Pages /Kids [] /Count 0 >>"],
	],
	"/Root 1 0 R",
)

it("explicitly recovers a PDF after a non-PDF prefix and reports it", () => {
	const prefix = "Publisher explanation\n".repeat(20)
	const warnings: unknown[] = []
	expect(() => parsePdf(prefix + source)).toThrow(PdfParseError)
	const document = parsePdf(prefix + source, {
		recover: true,
		onWarning: (warning) => warnings.push(warning),
	})
	expect(document).toEqual(parsePdf(source))
	expect(warnings).toEqual([
		expect.objectContaining({ code: "leading-bytes", offset: prefix.length }),
	])
	expect(parsePdf(serializePdf(document))).toEqual(document)
})

it("keeps recovered syntax error offsets relative to the original input", () => {
	const prefix = "prefix\n"
	const damaged = source.replace("/Catalog", "/#x0xxxx")
	let offset = -1
	try {
		parsePdf(damaged)
	} catch (e) {
		offset = (e as PdfParseError).offset
	}
	expect(offset).toBeGreaterThan(0)
	try {
		parsePdf(prefix + damaged, { recover: true })
		throw new Error("Expected malformed-name rejection")
	} catch (e) {
		expect(e).toBeInstanceOf(PdfParseError)
		expect((e as PdfParseError).offset).toBe(offset + prefix.length)
	}
})

it("bounds prefix recovery and leaves ordinary syntax validation enabled", () => {
	expect(() => parsePdf("x".repeat(1024) + source, { recover: true })).toThrow(
		/header/,
	)
	expect(() => parsePdf("not a PDF", { recover: true })).toThrow(/header/)
	expect(() =>
		parsePdf(source.replace("%PDF-1.7", "%PDF-9.9"), { recover: true }),
	).toThrow(/header/)
	expect(parsePdf(source, { recover: true })).toEqual(parsePdf(source))
})
