import { expect, it } from "vite-plus/test"
import { parsePdf, serializePdf } from "../../../src/index.ts"
import { originalFixtures } from "../../fixtures/original-corpus/documents.ts"
import { provePages } from "../../fixtures/original-corpus/proof.ts"
import "./setup.ts"

it.each(originalFixtures)(
	"preserves every original $id page's geometry, text, and pixels",
	async (fixture) => {
		const source = fixture.build()
		const document = parsePdf(source, fixture.parseOptions)
		const output = serializePdf(document, fixture.validationOptions)
		const password = fixture.parseOptions?.password
		if (password !== undefined && typeof password !== "string")
			throw new Error("This proof fixture requires a string password")
		const before = await provePages(
			source,
			password,
			fixture.parseOptions?.recover === true,
		)
		const after = await provePages(output)
		expect(after).toEqual(before)
		expect(before).toHaveLength(fixture.pages.length)
		for (const [index, expected] of fixture.pages.entries()) {
			expect(before[index]).toMatchObject({
				width: expected.width,
				height: expected.height,
				rotation: expected.rotation,
			})
			expect(before[index]!.text.replace(/\s/g, "")).toContain(
				expected.text.replace(/\s/g, ""),
			)
		}
		await expect(output).toMatchPdfArtifact(fixture.id, { resolution: 72 })
	},
)

it("rejects cross-reference repair during independent output proof", async () => {
	const source = Buffer.from(
		originalFixtures.find((fixture) => fixture.id === "field-notes")!.build(),
	).toString("latin1")
	const broken = Uint8Array.from(
		Buffer.from(
			source.replace(/startxref\s+\d+/, "startxref\n999999999"),
			"latin1",
		),
	)
	await expect(provePages(broken)).rejects.toThrow(
		"invalid cross-reference table",
	)
	// Confirm the failure is the xref gate: PDFium can still repair and render this input.
	await expect(provePages(broken, "", true)).resolves.toHaveLength(3)
})
