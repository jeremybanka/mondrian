import { expect, it } from "vite-plus/test"
import { readObject } from "../public/harness/read-object.ts"

it("decodes equivalent primitive syntax without imposing encoding or dictionary order", () => {
	const first = new TextEncoder().encode(
		"<< /A [null true false +1.50 17 2 R] /#FF#20 (<\\(\\)\\\\\\000\\377) >>",
	)
	const second = new TextEncoder().encode(
		"<< % a legal PDF comment\n /#ff#20 <3c28295c00ff> /#41 [ null true false 1.5 17 2 R ] >>",
	)
	const expected = new Map<string, unknown>([
		["41", [null, true, false, 1.5, { reference: [17, 2] }]],
		["ff20", { bytes: [60, 40, 41, 92, 0, 255] }],
	])
	expect(readObject(first)).toEqual(expected)
	expect(readObject(second)).toEqual(expected)
})
