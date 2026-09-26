import { expect, it } from "vite-plus/test"
import { zlibSync } from "fflate"
import {
	array,
	ascii,
	dictionary,
	name,
	nameBytes,
	serializePdf,
	stream,
} from "../../src/index.ts"
import { previewPdfPlates } from "../../src/testing.ts"
import { white, rawDocument, samples } from "./fixtures/plates.ts"
import "../../src/vitest.ts"

it.each([
	["Font", "BT /Missing 12 Tf ET"],
	["ExtGState", "/Missing gs"],
	["ColorSpace", "/Missing cs"],
	["XObject", "/Missing Do"],
])("treats indirect null %s resources as missing", (category, commands) => {
	const source = rawDocument((objects) => ({
		resources: dictionary({
			[category]: dictionary({}, [
				nameBytes(ascii("Missing")),
				objects.add(null),
			]),
		}),
		contents: [stream({}, ascii(commands))],
	}))
	expect(() => previewPdfPlates(source)).toThrow(
		`Missing ${category} resource /Missing`,
	)
})

it.each([false, true])(
	"treats optional null dictionary entries as absent (indirect: %s)",
	async (indirect) => {
		const source = rawDocument((objects) => {
			const nil = indirect ? objects.add(null) : null
			const child = objects.add(
				stream(
					{
						Type: name("XObject"),
						Subtype: name("Form"),
						BBox: array(0, 0, 80, 80),
						Group: nil,
						OC: nil,
						Ref: nil,
						Filter: nil,
					},
					ascii("/Ink cs 1 0 0 0 sc /State gs 10 10 60 60 re f"),
				),
			)
			return {
				page: { Group: nil, Annots: nil },
				resources: dictionary({
					ColorSpace: dictionary({
						Ink: name("DeviceCMYK"),
						Unused: nil,
						DefaultCMYK: nil,
					}),
					ExtGState: dictionary({
						State: dictionary({
							ca: nil,
							CA: nil,
							OP: nil,
							op: nil,
							OPM: nil,
							BM: nil,
							SMask: nil,
							TK: nil,
							TR: nil,
						}),
					}),
					XObject: dictionary({ Child: child }),
				}),
				contents: [
					stream(
						{ Filter: name("FlateDecode"), DecodeParms: nil },
						zlibSync(ascii("/Child Do")),
					),
				],
			}
		})
		const cyan = previewPdfPlates(source)[0]!.document
		expect(
			await samples(cyan, [
				[40, 40],
				[5, 5],
			]),
		).toEqual([[0, 174, 239, 255], white])
		if (!indirect)
			await expect(serializePdf(cyan)).toMatchPdfArtifact(
				"optional-null-entries",
				{ resolution: 72 },
			)
	},
)

it.each([false, true])(
	"accepts null resource categories (indirect: %s)",
	(indirect) => {
		const source = rawDocument((objects) => {
			const nil = indirect ? objects.add(null) : null
			return {
				contents: [],
				resources: dictionary({
					ColorSpace: nil,
					ExtGState: nil,
					XObject: nil,
				}),
			}
		})
		expect(previewPdfPlates(source)).toHaveLength(4)
	},
)
