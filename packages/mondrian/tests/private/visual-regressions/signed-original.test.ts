import { expect, it } from "vite-plus/test"
import { parsePdf, serializePdf } from "../../../src/index.ts"
import { provePages } from "../../fixtures/original-corpus/proof.ts"
import {
	signedReceipt,
	verifyReceiptSignature,
} from "../../fixtures/original-structure/signature-proof.ts"
import "./setup.ts"

it("preserves a genuinely signed receipt's visible page while rewriting its signed bytes", async () => {
	const input = signedReceipt()
	expect(verifyReceiptSignature(input).signatureValid).toBe(true)
	const output = serializePdf(parsePdf(input))
	const before = await provePages(input),
		after = await provePages(output)
	expect(after).toEqual(before)
	expect(before).toHaveLength(1)
	expect(before[0]).toMatchObject({ width: 420, height: 240, rotation: 0 })
	expect(before[0]!.text).toContain("Receipt for a paper moon")
	await expect(output).toMatchPdfArtifact("signed-receipt", { resolution: 72 })
})
