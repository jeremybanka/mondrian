import { expect, it } from "vite-plus/test"
import { parsePdf, serializePdf } from "mondrian.pdf"
import { previewPdfPlates } from "mondrian.pdf/testing"
import { markedTextDocument } from "../../public/helpers/marked-text.ts"
import { visualArtifactOptions } from "./setup.ts"

it("preserves the visible glyph under ActualText metadata on a parsed cyan plate", async () => {
	const delivered = serializePdf(markedTextDocument(true, true))
	const cyan = previewPdfPlates(parsePdf(delivered))[0]!
	await expect(serializePdf(cyan.document)).toMatchPdfArtifact(
		"cyan-text",
		visualArtifactOptions,
	)
})
