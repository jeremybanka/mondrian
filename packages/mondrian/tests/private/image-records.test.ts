import { readFileSync } from "node:fs"
import { expect, expectTypeOf, it } from "vite-plus/test"
import type { PdfImageRecord } from "../../src/content.ts"
import {
	createCmykImageHandle,
	createImageHandle,
	getImageRecord,
} from "../../src/content.ts"
import { grayscaleJpeg, rgbJpeg } from "./fixtures.ts"

it("requires an encoding discriminator and narrows the supported image variants", () => {
	expectTypeOf<{
		owner: symbol
		bytes: Uint8Array
		width: number
		height: number
		bitsPerComponent: 8
		colorSpace: "DeviceCMYK"
	}>().not.toExtend<PdfImageRecord>()
	expectTypeOf<PdfImageRecord["encoding"]>().toEqualTypeOf<"jpeg" | "raw">()
	type Jpeg = Extract<PdfImageRecord, { encoding: "jpeg" }>
	type Raw = Extract<PdfImageRecord, { encoding: "raw" }>
	expectTypeOf<Jpeg["colorSpace"]>().toEqualTypeOf<"DeviceGray" | "DeviceRGB">()
	expectTypeOf<Jpeg["alpha"]>().toEqualTypeOf<undefined>()
	expectTypeOf<Raw["colorSpace"]>().toEqualTypeOf<"DeviceCMYK" | "DeviceRGB">()
	expectTypeOf<Raw["alpha"]>().toEqualTypeOf<Uint8Array | undefined>()
})

it.each([grayscaleJpeg, rgbJpeg])(
	"records JPEG encoding independently of its color space (%#)",
	(fixture) => {
		const bytes = fixture()
		const record = getImageRecord(createImageHandle(Symbol(), bytes))
		expect(record.encoding).toBe("jpeg")
		expect(record.bytes).toEqual(bytes)
	},
)

it("records prepared CMYK samples as raw raster bytes", () => {
	const data = Uint8Array.of(20, 40, 60, 80)
	const alpha = Uint8Array.of(128)
	const record = getImageRecord(
		createCmykImageHandle(Symbol(), {
			width: 1,
			height: 1,
			data,
			alpha,
			destinationProfile: readFileSync(
				new URL(
					"../public/fixtures/print-images/CGATS21_CRPC6.icc",
					import.meta.url,
				),
			),
		}),
	)
	expect(record.encoding).toBe("raw")
	expect(record.bytes).toEqual(data)
	expect(record.alpha).toEqual(alpha)
})
