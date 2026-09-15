import { expect, it } from "vite-plus/test"
import { exampleDocument } from "../../public/fixtures.ts"
import { visualArtifactOptions } from "./setup.ts"

it("renders the consumer document used by the compatibility suite", async () => {
	await expect(exampleDocument().serialize()).toMatchPdfArtifact(
		"consumer-document",
		visualArtifactOptions,
	)
})
