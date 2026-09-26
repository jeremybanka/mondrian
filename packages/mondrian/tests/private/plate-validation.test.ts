import { describe, expect, it } from "vite-plus/test"
import { array, ascii, dictionary, name, stream } from "../../src/index.ts"
import { previewPdfPlates } from "../../src/testing.ts"
import { rawDocument } from "./fixtures/plates.ts"

describe("discovery failures", () => {
	it.each([
		["1 0 0 rg", /DeviceRGB/u],
		["0 g", /DeviceGray/u],
		["0 0 20 20 re S", /Implicit DeviceGray stroke/u],
		["/Shade sh", /operator sh/u],
		["BI", /operator BI/u],
		["/OC /Layer BDC", /operator BDC/u],
		["Q", /Unbalanced Q/u],
		["q", /Unbalanced q/u],
		["1 0 0 k", /Invalid plate color components/u],
		["2 0 0 0 k", /Invalid plate color components/u],
		["8 Tr", /Invalid text rendering mode/u],
		["/Missing gs", /Missing ExtGState/u],
	])("rejects unsupported or malformed content %s", (commands, message) => {
		expect(() =>
			previewPdfPlates(
				rawDocument(() => ({ contents: [stream({}, ascii(commands))] })),
			),
		).toThrow(message)
	})
	it.each([
		[{ BM: name("Multiply") }, /Normal blending/u],
		[{ BM: array(name("Normal"), 1) }, /Expected blend-mode names/u],
		[{ SMask: dictionary({ S: name("Alpha") }) }, /Soft masks/u],
		[{ ca: 2 }, /opacity/u],
		[{ CA: -1 }, /opacity/u],
		[{ OPM: 2 }, /overprint mode/u],
		[{ OP: 1 }, /overprint flag/u],
		[{ op: 1 }, /overprint flag/u],
		[{ TK: 1 }, /Text knockout.*boolean/u],
		[{ TR: name("Identity") }, /graphics state setting/u],
	] as const)("rejects unsupported graphics states %j", (state, message) => {
		expect(() =>
			previewPdfPlates(
				rawDocument(() => ({
					contents: [stream({}, ascii("/State gs"))],
					resources: dictionary({
						ExtGState: dictionary({ State: dictionary(state) }),
					}),
				})),
			),
		).toThrow(message)
	})
	it("rejects forbidden process paint in spot-only mode and invalid options", () => {
		const source = rawDocument(() => ({
			contents: [stream({}, ascii("0 0 0 1 k"))],
		}))
		expect(() => previewPdfPlates(source, { permitColors: ["spot"] })).toThrow(
			/DeviceCMYK.*not permitted/u,
		)
		expect(() =>
			previewPdfPlates(source, { permitColors: ["rgb" as "cmyk"] }),
		).toThrow(/permitColors/u)
	})
	it("rejects image color spaces, transparency groups, Type3 fonts, and annotations", () => {
		const image = rawDocument((objects) => ({
			resources: dictionary({
				XObject: dictionary({
					Image: objects.add(
						stream(
							{
								Type: name("XObject"),
								Subtype: name("Image"),
								Width: 1,
								Height: 1,
								BitsPerComponent: 8,
								ColorSpace: name("DeviceRGB"),
							},
							Uint8Array.of(255, 0, 0),
						),
					),
				}),
			}),
			contents: [stream({}, ascii("/Image Do"))],
		}))
		expect(() => previewPdfPlates(image)).toThrow(/DeviceRGB/u)
		for (const page of [
			{ Group: dictionary({ S: name("Transparency") }) },
			{ Annots: array(dictionary({ Subtype: name("Text") })) },
		])
			expect(() =>
				previewPdfPlates(rawDocument(() => ({ contents: [], page }))),
			).toThrow(/unsupported/u)
		const font = rawDocument(() => ({
			resources: dictionary({
				Font: dictionary({ F: dictionary({ Subtype: name("Type3") }) }),
			}),
			contents: [stream({}, ascii("/F 12 Tf"))],
		}))
		expect(() => previewPdfPlates(font)).toThrow(/Type3/u)
	})
})
