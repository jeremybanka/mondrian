import { describe, expect, it } from "vite-plus/test"
import {
	createDesignColor,
	createDesignFragment,
	objectPrintExample,
	orangeInk,
	packOsFragment,
} from "../../examples/print-colors.ts"
import { cmyk, separation, serializePdf, validatePdf } from "../../src/index.ts"

describe("consumer color integration examples", () => {
	it("keeps create-design percentage and byte conversion at the adapter boundary", () => {
		expect(
			createDesignColor({ space: "cmyk", c: 0, m: 66, y: 100, k: 0 }),
		).toEqual(cmyk(0, 0.66, 1, 0))
		expect(createDesignColor({ space: "rgb", r: 255, g: 0, b: 0 })).toEqual({
			space: "DeviceRGB",
			components: [1, 0, 0],
		})
		expect(() =>
			createDesignColor({ space: "cmyk", c: 101, m: 0, y: 0, k: 0 }),
		).toThrow()
	})

	it("reuses the cached create-design path with Pack OS process/spot requirements", () => {
		const cached = [createDesignFragment(), packOsFragment()]
		const document = objectPrintExample(cached)
		expect(validatePdf(document)).toEqual([])
		expect(serializePdf(objectPrintExample(cached))).toEqual(
			serializePdf(document),
		)
		const pdf = new TextDecoder().decode(serializePdf(document))
		expect(pdf).toContain("0 0.66 1 0 k")
		expect(pdf).toContain("/Separation /Brand#20Orange")
		expect(pdf).toContain("0.75 scn")
		expect(pdf).toContain("/OPM 1")
		expect(pdf).toContain("(Positioned text with a named ink) Tj")
	})

	it("invalidates the ink-bearing fragment while keeping the cached custom path", () => {
		const path = createDesignFragment()
		const before = serializePdf(objectPrintExample([path, packOsFragment()]))
		const changed = separation(orangeInk.name, {
			...orangeInk.tintTransform,
			full: cmyk(0, 0.4, 1, 0),
		})
		const after = serializePdf(
			objectPrintExample([path, packOsFragment(changed)]),
		)
		expect(after).not.toEqual(before)
		expect(new TextDecoder().decode(after)).toContain("/C1 [0 0.4 1 0]")
	})
})
