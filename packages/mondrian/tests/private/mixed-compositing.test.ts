import { expect, it } from "vite-plus/test"
import { readFileSync } from "node:fs"
import { zlibSync } from "fflate"
import { array, ascii, dictionary, name, stream } from "../../src/index.ts"
import { prepareCmykImage, preparePdfForPrint } from "../../src/print.ts"
import { renderPdfPlateCoverage } from "../../src/testing.ts"
import { rawDocument } from "./fixtures/plates.ts"
import {
	printOptions,
	sourceProfile,
	destinationProfile,
} from "../public/fixtures/mixed-color/document.ts"

it.each([false, true])(
	"composites converted process amounts and retained spot tints under alpha, constant opacity, and overprint %s",
	async (overprint) => {
		const data = Uint8Array.from(
				{ length: 12 },
				(_, i) => [210, 85, 35][i % 3]!,
			),
			alpha = Uint8Array.of(0, 64, 128, 255)
		const ink = array(
			name("Separation"),
			name("Forest Green"),
			name("DeviceRGB"),
			dictionary({
				FunctionType: 2,
				Domain: array(0, 1),
				C0: array(1, 1, 1),
				C1: array(0.2, 0.55, 0.32),
				N: 1,
			}),
		)
		const backdrop =
			"0.2 0.4 0.6 0.8 k 0 0 80 80 re f /Keep gs /Ink cs 0.7 scn 0 0 80 80 re f"
		const states = {
			Keep: dictionary({ op: true, OPM: 1 }),
			Image: dictionary({ op: overprint, OPM: 1, ca: 0.5 }),
		}
		const source = rawDocument((objects) => {
			const icc = array(
				name("ICCBased"),
				objects.add(stream({ N: 3 }, sourceProfile)),
			)
			const mask = objects.add(
				stream(
					{
						Subtype: name("Image"),
						Width: 4,
						Height: 1,
						BitsPerComponent: 8,
						ColorSpace: name("DeviceGray"),
						Filter: name("FlateDecode"),
						DecodeParms: dictionary({
							BitsPerComponent: 8,
							Colors: 1,
							Columns: 4,
						}),
					},
					zlibSync(alpha),
				),
			)
			const image = objects.add(
				stream(
					{
						Subtype: name("Image"),
						Width: 4,
						Height: 1,
						BitsPerComponent: 8,
						ColorSpace: icc,
						SMask: mask,
					},
					data,
				),
			)
			return {
				page: {
					Group: dictionary({
						S: name("Transparency"),
						CS: icc,
						I: false,
						K: false,
					}),
				},
				resources: dictionary({
					ColorSpace: dictionary({ Ink: ink }),
					ExtGState: dictionary(states),
					XObject: dictionary({ Photo: image }),
				}),
				contents: [
					stream(
						{},
						ascii(`${backdrop} /Image gs q 80 0 0 80 0 0 cm /Photo Do Q`),
					),
				],
			}
		})
		const prepared = await preparePdfForPrint(source, printOptions)
		const referenceImage = await prepareCmykImage(
			readFileSync(
				new URL("../public/fixtures/print-images/rgba.png", import.meta.url),
			),
			{ destinationProfile, sourceProfile },
		)
		const reference = rawDocument(() => ({
			resources: dictionary({
				ColorSpace: dictionary({ Ink: ink }),
				ExtGState: dictionary({
					...states,
					...Object.fromEntries(
						[...alpha].map((a, i) => [
							`A${i}`,
							dictionary({ op: overprint, OPM: 1, ca: (a / 255) * 0.5 }),
						]),
					),
				}),
			}),
			contents: [
				stream(
					{},
					ascii(
						`${backdrop} ${[...alpha].map((_, i) => `/A${i} gs ${[...referenceImage.data.subarray(i * 4, i * 4 + 4)].map((v) => v / 255).join(" ")} k ${i * 20} 0 20 80 re f`).join(" ")}`,
					),
				),
			],
		}))
		const actual = await renderPdfPlateCoverage(prepared.document, {
				resolution: 72,
			}),
			expected = await renderPdfPlateCoverage(reference, { resolution: 72 })
		for (let plate = 0; plate < 5; plate++)
			for (const x of [10, 30, 50, 70])
				expect(
					Math.abs(
						actual.plates[plate]!.pages[0]!.samples[40 * 80 + x]! -
							expected.plates[plate]!.pages[0]!.samples[40 * 80 + x]!,
					),
				).toBeLessThanOrEqual(1)
	},
)
