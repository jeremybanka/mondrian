import { createHash } from "node:crypto"
import { deflateSync, inflateSync } from "node:zlib"
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib"
import { expect, it } from "vite-plus/test"
import { parsePdf, serializePdf, validatePdf } from "../../src/index.ts"
import {
	tetrahedron,
	tetrahedronHash,
	threeDimensionalParcel,
} from "../fixtures/original-corpus/three-dimensional.ts"
import { provePages } from "../fixtures/original-corpus/proof.ts"

const hash = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex")

async function verifyMesh(bytes: Uint8Array) {
	const independent = await PDFDocument.load(bytes)
	const page = independent.getPages()[0]!
	const annotation = independent.context.lookup(
		page.node.Annots()!.get(0),
		PDFDict,
	)
	expect(annotation.get(PDFName.of("Subtype"))).toBe(PDFName.of("3D"))
	const model = independent.context.lookup(
		annotation.get(PDFName.of("3DD")),
	)
	if (!(model instanceof PDFRawStream)) throw new Error("Missing PRC stream")
	expect(model.dict.get(PDFName.of("Subtype"))).toBe(PDFName.of("PRC"))
	expect(model.dict.get(PDFName.of("Filter"))).toBe(PDFName.of("FlateDecode"))
	if (hash(inflateSync(model.contents)) !== tetrahedronHash)
		throw new Error("PRC payload differs from independently verified mesh")
	expect(
		independent.context.lookup(annotation.get(PDFName.of("3DV")))?.toString(),
	).toContain("/Type /3DView")
}

it("preserves a verified original PRC mesh, its view, and the 3D annotation relationships", async () => {
	const payload = tetrahedron()
	expect(payload.length).toBe(537)
	// This hash binds the file to the independent mesh verification in generate-prc.ts.
	expect(hash(payload)).toBe(tetrahedronHash)
	const input = threeDimensionalParcel()
	expect(threeDimensionalParcel()).toEqual(input)
	const document = parsePdf(input)
	expect(validatePdf(document)).toEqual([])
	const output = serializePdf(document)
	expect(parsePdf(output)).toEqual(document)
	for (const bytes of [input, output]) await verifyMesh(bytes)
})

it("rejects a missing mesh even when the page proof is unchanged", async () => {
	const input = threeDimensionalParcel()
	const document = parsePdf(input)
	const corrupted = serializePdf({
		...document,
		objects: document.objects.map((object) => {
			if (object.objectNumber !== 7) return object
			const model = object.value
			if (
				model === null ||
				typeof model !== "object" ||
				model.kind !== "stream"
			)
				throw new Error("Missing PRC stream")
			return {
				...object,
				value: { ...model, data: deflateSync(new Uint8Array()) },
			}
		}),
	})
	await expect(verifyMesh(corrupted)).rejects.toThrow("PRC payload differs")
	expect(await provePages(corrupted)).toEqual(await provePages(input))
})
