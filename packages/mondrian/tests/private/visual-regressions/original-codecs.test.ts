import { describe, expect, it } from "vite-plus/test"
import { parsePdf, serializePdf } from "../../../src/index.ts"
import {
	codecDocument,
	codecFixtures,
} from "../../fixtures/original-corpus/codecs/documents.ts"
import { provePages } from "../../fixtures/original-corpus/proof.ts"
import "./setup.ts"

describe.each(codecFixtures)("original $id codec proof", (fixture) => {
	it("matches authored raw pixels before and after parse/serialize, and the reviewed page", async () => {
		const source = codecDocument(fixture)
		const output = serializePdf(parsePdf(source))
		const reference = await provePages(codecDocument(fixture, "raw"))
		const before = await provePages(source)
		const after = await provePages(output)
		expect(before).toEqual(reference)
		expect(after).toEqual(reference)
		expect(before).toHaveLength(1)
		expect(before[0]).toMatchObject({ width: 320, height: 280, rotation: 0 })
		expect(before[0]!.text).toContain(fixture.title)
		await expect(output).toMatchPdfArtifact(fixture.id, { resolution: 72 })
	})

	it("detects removal of the image operator and bypass of the codec", async () => {
		const reference = await provePages(codecDocument(fixture, "raw"))
		const hidden = await provePages(codecDocument(fixture, "hidden"))
		const bypassed = await provePages(codecDocument(fixture, "no-filter"))
		expect(hidden[0]!.pixels).not.toBe(reference[0]!.pixels)
		expect(bypassed[0]!.pixels).not.toBe(reference[0]!.pixels)
	})
})
