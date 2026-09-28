import { expect, it } from "vite-plus/test"
import { zlibSync, unzlibSync } from "fflate"
import { ascii, dictionary, name, stream } from "../../src/index.ts"
import type { PdfDocument, PdfStream } from "../../src/index.ts"
import { previewPdfPlates } from "../../src/testing.ts"
import { planPdfPlates } from "../../src/testing/plate-plan.ts"
import { rawDocument } from "./fixtures/plates.ts"

function imagePair(sharedMask: boolean, mismatchedDimensions = false) {
	return rawDocument((objects) => {
		const mask = () =>
			objects.add(
				stream(
					{
						Type: name("XObject"),
						Subtype: name("Image"),
						Width: 2,
						Height: 1,
						ColorSpace: name("DeviceGray"),
						BitsPerComponent: 8,
						Filter: name("FlateDecode"),
					},
					zlibSync(Uint8Array.of(64, 192)),
				),
			)
		const firstMask = mask()
		const image = (second: boolean) =>
			objects.add(
				stream(
					{
						Type: name("XObject"),
						Subtype: name("Image"),
						Width: second && mismatchedDimensions ? 1 : 2,
						Height: second && mismatchedDimensions ? 2 : 1,
						ColorSpace: name("DeviceCMYK"),
						BitsPerComponent: 8,
						SMask: second && !sharedMask ? mask() : firstMask,
					},
					Uint8Array.of(255, 0, 0, 0, 0, 255, 0, 0),
				),
			)
		return {
			resources: dictionary({
				XObject: dictionary({ First: image(false), Second: image(true) }),
			}),
			contents: [stream({}, ascii("/First Do /Second Do"))],
		}
	})
}

function plannedImages(document: PdfDocument) {
	return planPdfPlates(document, new Set(["cmyk"]))
		.pages[0]!.scope.instructions.filter(
			(instruction) => instruction.kind === "image",
		)
		.map((instruction) => instruction.image)
}

function imageStreams(document: PdfDocument, colorSpace: string) {
	return document.objects
		.map((object) => object.value)
		.filter((value): value is PdfStream => {
			if (
				value === null ||
				typeof value !== "object" ||
				value.kind !== "stream"
			)
				return false
			const space = value.entries.ColorSpace
			return (
				space !== null &&
				typeof space === "object" &&
				space.kind === "name" &&
				space.value === colorSpace
			)
		})
}

it.each([true, false])(
	"caches masks by source stream identity (shared: %s)",
	(shared) => {
		const document = imagePair(shared)
		const images = plannedImages(document)
		expect(images).toHaveLength(2)
		expect(images[0]).not.toBe(images[1])
		expect(images[0]!.alpha).toBeDefined()
		expect(images[1]!.alpha).toBeDefined()
		if (shared) expect(images[0]!.alpha).toBe(images[1]!.alpha)
		else expect(images[0]!.alpha).not.toBe(images[1]!.alpha)
		// A new plan must not reuse decoded objects from an earlier operation.
		expect(plannedImages(document)[0]!.alpha).not.toBe(images[0]!.alpha)
		for (const plate of previewPdfPlates(document)) {
			const masks = imageStreams(plate.document, "DeviceGray")
			expect(masks).toHaveLength(shared ? 1 : 2)
			for (const mask of masks)
				expect(unzlibSync(mask.data)).toEqual(Uint8Array.of(64, 192))
			const projected = imageStreams(plate.document, "DeviceCMYK")
			expect(projected).toHaveLength(2)
			if (shared)
				expect(projected[0]!.entries.SMask).toEqual(projected[1]!.entries.SMask)
			else
				expect(projected[0]!.entries.SMask).not.toEqual(
					projected[1]!.entries.SMask,
				)
		}
	},
)

it("checks each parent against the dimensions of a reused mask", () => {
	expect(() => previewPdfPlates(imagePair(true, true))).toThrow(
		/image and soft mask must have matching dimensions/,
	)
})
