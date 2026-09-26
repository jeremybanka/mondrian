import { expect, it } from "vite-plus/test"
import { serializePdf } from "mondrian.pdf"
import { previewPdfPlates } from "mondrian.pdf/testing"
import { printPlateExample } from "../../../examples/print-plates.ts"
import { visualArtifactOptions } from "./setup.ts"

it("renders colored coverage, tints, knockout, overprint, and live text on each plate", async () => {
	const source = printPlateExample()
	await expect(serializePdf(source)).toMatchPdfArtifact(
		"composite",
		visualArtifactOptions,
	)
	for (const plate of previewPdfPlates(source)) {
		await expect(serializePdf(plate.document)).toMatchPdfArtifact(
			plate.name.toLowerCase(),
			visualArtifactOptions,
		)
	}
})
