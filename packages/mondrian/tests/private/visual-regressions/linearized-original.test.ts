import { expect, it } from "vite-plus/test"
import { parsePdf, serializePdf } from "../../../src/index.ts"
import {
	linearizationSource,
	linearizedBooklet,
} from "../../fixtures/original-structure/booklet.ts"
import { provePages } from "../../fixtures/original-corpus/proof.ts"
import "./setup.ts"

it("preserves every genuinely linearized page and shared resource", async () => {
	const input = linearizedBooklet(),
		output = serializePdf(parsePdf(input))
	const authored = await provePages(linearizationSource())
	const before = await provePages(input),
		after = await provePages(output)
	expect(before).toEqual(authored)
	expect(after).toEqual(before)
	expect(before).toHaveLength(4)
	for (const [index, season] of ["Seed", "Leaf", "Bloom", "Rest"].entries()) {
		expect(before[index]).toMatchObject({
			width: 300,
			height: 180,
			rotation: 0,
		})
		expect(before[index]!.text).toContain(`Paper garden: ${season}`)
	}
	await expect(output).toMatchPdfArtifact("linearized-garden", {
		resolution: 72,
	})
})
