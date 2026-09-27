import { expect, it } from "vite-plus/test"
import { parsePdf, serializePdf } from "../../../src/index.ts"
import { encryptedPdf } from "../../fixtures/encrypted.ts"
import { visualArtifactOptions } from "./setup.ts"

it("renders the decrypted AES-256 content stream", async () => {
	const document = parsePdf(encryptedPdf().source)
	await expect(serializePdf(document)).toMatchPdfArtifact(
		"decrypted-aes256",
		visualArtifactOptions,
	)
})
