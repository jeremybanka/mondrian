import { expect, it } from "vite-plus/test"
import {
	array,
	ascii,
	createPdfObjectBuilder,
	dictionary,
	name,
	serializePdf,
	stream,
} from "../../../src/index.ts"
import type { PdfPagesDictionary } from "../../../src/index.ts"
import { visualArtifactOptions } from "./setup.ts"

it("proofs a red stamp annotation appearance", async () => {
	const objects = createPdfObjectBuilder()
	const pages = objects.reserve<PdfPagesDictionary>()
	const appearance = objects.add(
		stream(
			{
				Type: name("XObject"),
				Subtype: name("Form"),
				BBox: array(0, 0, 20, 20),
				Resources: dictionary({}),
			},
			ascii("1 0 0 rg 0 0 20 20 re f"),
		),
	)
	const stamp = objects.add(
		dictionary({
			Type: name("Annot"),
			Subtype: name("Stamp"),
			Rect: array(10, 10, 30, 30),
			F: 4,
			AP: dictionary({ N: appearance }),
		}),
	)
	const page = objects.add(
		dictionary({
			Type: name("Page"),
			Parent: pages.ref,
			MediaBox: array(0, 0, 40, 40),
			Resources: dictionary({}),
			Annots: array(stamp),
		}),
	)
	pages.set(dictionary({ Type: name("Pages"), Kids: array(page), Count: 1 }))
	const root = objects.add(
		dictionary({ Type: name("Catalog"), Pages: pages.ref }),
	)
	const bytes = serializePdf(objects.build({ root }))
	await expect(bytes).toMatchPdfArtifact("red-stamp", {
		...visualArtifactOptions,
		renderAnnotations: true,
	})
})
