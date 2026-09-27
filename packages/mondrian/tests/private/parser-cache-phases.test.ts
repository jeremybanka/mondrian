import { expect, it } from "vitest"
import { parsePdf, serializePdf, validatePdf } from "../../src/index.ts"
import { encryptedRevisions } from "../fixtures/encrypted-revisions.ts"
import { provePages } from "../fixtures/original-corpus/proof.ts"

it.each([0, 1])(
	"isolates revision lookups from decryption and final objects (password vector: %s)",
	async (vector) => {
		const { source, password } = encryptedRevisions(vector)
		const expectedPages = await provePages(
			Buffer.from(source, "latin1"),
			password,
		)
		const document = parsePdf(source, { password })
		expect(validatePdf(document).filter((d) => d.severity === "error")).toEqual(
			[],
		)
		const output = serializePdf(document)
		for (const result of [document, parsePdf(output)]) {
			const value = (number: number) =>
				result.objects.find((o) => o.objectNumber === number)?.value
			expect(value(8)).toMatchObject({
				bytes: new TextEncoder().encode("Current encrypted value"),
			})
			expect(value(9)).toMatchObject({
				entries: {
					Description: {
						bytes: new TextEncoder().encode("Current clear filter"),
					},
				},
			})
			expect(value(12)).toMatchObject({
				entries: {
					Text: {
						bytes: new TextEncoder().encode("Current compressed member"),
					},
				},
			})
			expect(value(6)).toMatchObject({
				entries: {
					Title: { bytes: new TextEncoder().encode("Encrypted fixture") },
				},
			})
			expect(value(10)).toBeUndefined()
			expect(value(13)).toBeUndefined()
			expect(value(14)).toBeUndefined()
		}
		expect(await provePages(output)).toEqual(expectedPages)
	},
)
