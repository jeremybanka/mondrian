import { createHash } from "node:crypto"
import { isDeepStrictEqual } from "node:util"
import { expect, it } from "vite-plus/test"
import { parsePdf, serializePdf, validatePdf } from "../../../src/index.ts"
import { provePages } from "../../fixtures/original-corpus/proof.ts"
import { proveOutlines } from "../../fixtures/original-structure/outline-proof.ts"
import {
	scaleDocument,
	scaleObjectCount,
	scaleOutlineCount,
	scaleOutlineDepth,
	scalePageCount,
	scalePayloadBytes,
	scaleRepresentative,
} from "../../fixtures/original-structure/scale.ts"
import "./setup.ts"

it(
	"roundtrips 420 pages, 3891 objects, 64-level outlines and a 31 MiB original payload",
	{ timeout: 60_000 },
	async () => {
		const source = scaleDocument()
		expect(source.length).toBeGreaterThan(scalePayloadBytes)
		expect(source.length).toBeLessThan(scalePayloadBytes + 1024 * 1024)
		const document = parsePdf(source)
		expect(document.objects).toHaveLength(scaleObjectCount)
		expect(validatePdf(document)).toEqual([])
		const payload = document.objects.find(
			(object) => object.objectNumber === 4,
		)?.value
		if (
			payload === undefined ||
			payload === null ||
			typeof payload !== "object" ||
			payload.kind !== "stream"
		)
			throw new Error("Missing large original payload")
		expect(payload.data).toHaveLength(scalePayloadBytes)
		expect(createHash("sha256").update(payload.data).digest("hex")).toBe(
			"e89129ba4ae1f9f2596fd12a86cfbdc853e4e9543a0be4a6a0fda9ec23bb2289",
		)
		const output = serializePdf(document),
			reparsed = parsePdf(output)
		expect(isDeepStrictEqual(reparsed, document)).toBe(true)
		expect(Buffer.from(serializePdf(reparsed)).equals(output)).toBe(true)
		const outlines = await proveOutlines(source)
		expect(await proveOutlines(output)).toEqual(outlines)
		expect(outlines).toHaveLength(scaleOutlineCount)
		expect(Math.max(...outlines.map((outline) => outline.depth))).toBe(
			scaleOutlineDepth,
		)
		expect(
			outlines
				.filter((outline) => outline.title.startsWith("Record "))
				.map((outline) => outline.page),
		).toEqual(Array.from({ length: scalePageCount }, (_, page) => page))
		expect(outlines.at(-1)).toEqual({
			title: "Nested appendix 63",
			depth: 64,
			page: 419,
		})
		const before = await provePages(source),
			after = await provePages(output)
		expect(after).toEqual(before)
		expect(before).toHaveLength(scalePageCount)
		const representatives = [scaleRepresentative(0), scaleRepresentative(1)]
		const expected = [
			(await provePages(representatives[0]!))[0]!,
			(await provePages(representatives[1]!))[0]!,
		]
		for (let index = 0; index < before.length; index++) {
			// Every page must exactly equal its reviewed representative, not just selected pages.
			expect(before[index], `page ${index + 1}`).toEqual(expected[index % 2])
			expect(before[index]).toMatchObject({
				width: 240,
				height: 180,
				rotation: 0,
			})
			expect(before[index]!.text).toContain(
				index % 2 ? "Southern ledger" : "Northern ledger",
			)
		}
		await expect(representatives[0]!).toMatchPdfArtifact("large-ledger-north", {
			resolution: 72,
		})
		await expect(representatives[1]!).toMatchPdfArtifact("large-ledger-south", {
			resolution: 72,
		})
	},
)
