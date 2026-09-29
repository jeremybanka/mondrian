import { expect, it } from "vite-plus/test"
import { serializePdf } from "mondrian.pdf"
import { previewPdfPlates } from "mondrian.pdf/testing"
import { printImageExample } from "../../../examples/print-images.ts"
import { visualArtifactOptions } from "./setup.ts"

it("renders a photographic PNG cut-out over process and spot inks on the delivered PDF and every plate", async () => {
	const document = await printImageExample()
	await expect(serializePdf(document)).toMatchPdfArtifact(
		"composite",
		visualArtifactOptions,
	)
	const plates = previewPdfPlates(document)
	expect(plates.map((plate) => plate.name)).toEqual([
		"Cyan",
		"Magenta",
		"Yellow",
		"Black",
		"Leaf Green",
		"Violet",
	])
	for (const plate of plates)
		await expect(serializePdf(plate.document)).toMatchPdfArtifact(
			plate.name.toLowerCase().replaceAll(" ", "-"),
			visualArtifactOptions,
		)
}, 30_000)
