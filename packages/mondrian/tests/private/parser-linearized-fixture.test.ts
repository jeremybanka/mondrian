import { createHash } from "node:crypto"
import { isDeepStrictEqual } from "node:util"
import { expect, it } from "vite-plus/test"
import { parsePdf, serializePdf, validatePdf } from "../../src/index.ts"
import {
	linearizationSource,
	linearizedBooklet,
} from "../fixtures/original-structure/booklet.ts"
import proof from "../fixtures/original-structure/linearization-proof.json" with { type: "json" }

it("imports a genuinely linearized, independently checked four-page booklet", () => {
	const bytes = linearizedBooklet()
	const sha256 = (value: Uint8Array) =>
		createHash("sha256").update(value).digest("hex")
	// Bind the generation-time qpdf syntax/hint-table proof to the exact fixture.
	expect(sha256(bytes)).toBe(proof.sha256)
	expect(sha256(linearizationSource())).toBe(proof.sourceSha256)
	expect(proof.checkLinearization).toBe(
		"linearized-garden.pdf: no linearization errors\n",
	)
	expect(proof.hints).toContain("npages: 4")
	expect(proof.hints).toContain("nshared_total: 5")
	const document = parsePdf(bytes)
	expect(
		validatePdf(document).map(({ severity, code }) => ({ severity, code })),
	).toEqual([
		{ severity: "warning", code: "unreachable-object" },
		{ severity: "warning", code: "unreachable-object" },
	])
	const linearization = document.objects.find(
		(object) =>
			object.value !== null &&
			typeof object.value === "object" &&
			object.value.kind === "dictionary" &&
			object.value.entries.Linearized === 1,
	)
	expect(linearization?.value).toMatchObject({
		entries: { L: bytes.length, N: 4, O: 12, E: 2500 },
	})
	const output = serializePdf(document),
		reparsed = parsePdf(output)
	expect(isDeepStrictEqual(reparsed, document)).toBe(true)
	expect(serializePdf(reparsed)).toEqual(output)
})
