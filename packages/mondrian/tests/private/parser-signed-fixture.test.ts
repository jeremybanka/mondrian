import { createHash } from "node:crypto"
import { isDeepStrictEqual } from "node:util"
import { expect, it } from "vite-plus/test"
import { parsePdf, serializePdf, validatePdf } from "../../src/index.ts"
import {
	signedReceipt,
	verifyReceiptSignature,
} from "../fixtures/original-structure/signature-proof.ts"
import { unsignedReceipt } from "../fixtures/original-structure/signing-source.ts"
import proof from "../fixtures/original-structure/signature-proof.json" with { type: "json" }

it("cryptographically verifies the original signature before parsing its graph", () => {
	const source = signedReceipt(),
		verified = verifyReceiptSignature(source)
	expect(createHash("sha256").update(source).digest("hex")).toBe(proof.sha256)
	expect(verified).toMatchObject({
		signatureValid: true,
		selfSignatureValid: true,
		coversDocument: true,
		byteRange: proof.byteRange,
		certificateSha256: proof.certificateSha256,
		signedBytesSha256: proof.signedBytesSha256,
	})
	expect(
		createHash("sha256").update(unsignedReceipt(), "latin1").digest("hex"),
	).toBe(proof.sourceSha256)
	expect(proof.pdfVerification).toContain(
		"Signature Validation: Signature is Valid.",
	)
	expect(proof.verification).toBe("CMS Verification successful")
	expect(verified.cms).toHaveLength(proof.signatureBytes)
	const document = parsePdf(source)
	expect(validatePdf(document)).toEqual([])
	const output = serializePdf(document),
		reparsed = parsePdf(output)
	expect(isDeepStrictEqual(reparsed, document)).toBe(true)
	expect(serializePdf(reparsed)).toEqual(output)
	// Rewriting retains signature dictionary bytes, not the original signed byte layout.
	const rewritten = verifyReceiptSignature(output)
	expect(rewritten.cms).toEqual(verified.cms)
	expect(rewritten.byteRange).toEqual(verified.byteRange)
	expect(rewritten.coversDocument).toBe(false)
	expect(rewritten.signatureValid).toBe(false)
})

it("detects a single-byte change to signed content independently of PDF parsing", () => {
	const source = Buffer.from(signedReceipt())
	const index = source.indexOf("MOON-031")
	expect(index).toBeGreaterThan(0)
	source[index + 7] = "2".charCodeAt(0)
	const verified = verifyReceiptSignature(source)
	expect(verified.coversDocument).toBe(true)
	expect(verified.signatureValid).toBe(false)
})
