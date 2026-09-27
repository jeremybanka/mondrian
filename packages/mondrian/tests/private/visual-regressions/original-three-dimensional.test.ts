import { expect, it } from "vite-plus/test"
import { parsePdf, serializePdf } from "../../../src/index.ts"
import { threeDimensionalParcel } from "../../fixtures/original-corpus/three-dimensional.ts"
import { provePages } from "../../fixtures/original-corpus/proof.ts"
import "./setup.ts"

it("preserves the original 3D parcel's page and annotation appearance", async () => {
	const source = threeDimensionalParcel()
	const output = serializePdf(parsePdf(source))
	const before = await provePages(source)
	expect(before).toHaveLength(1)
	expect(before[0]).toMatchObject({ width: 360, height: 240, rotation: 0 })
	expect(before[0]!.text).toContain("A parcel in three dimensions")
	expect(await provePages(output)).toEqual(before)
	await expect(output).toMatchPdfArtifact("three-dimensional-parcel", {
		resolution: 72,
	})
})
