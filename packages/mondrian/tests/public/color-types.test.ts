import { expectTypeOf, it } from "vite-plus/test"
import { cmyk, gray, rgb, separation, spot } from "mondrian.pdf"
import type {
	PdfCmykColor,
	PdfColor,
	PdfGrayColor,
	PdfProcessColor,
	PdfRgbColor,
	PdfSeparationColor,
	PdfSpotColor,
} from "mondrian.pdf"

it("returns individually exported color types from the public helpers", () => {
	const grayColor = gray(0.5)
	const rgbColor = rgb(1, 0, 0)
	const cmykColor = cmyk(0, 1, 1, 0)
	const ink = separation("Brand Red", {
		type: "exponential",
		zero: rgb(1, 1, 1),
		full: rgbColor,
		exponent: 1,
	})
	const spotColor = spot(ink, 0.5)

	expectTypeOf(grayColor).toEqualTypeOf<PdfGrayColor>()
	expectTypeOf(rgbColor).toEqualTypeOf<PdfRgbColor>()
	expectTypeOf(cmykColor).toEqualTypeOf<PdfCmykColor>()
	expectTypeOf(spotColor).toEqualTypeOf<PdfSeparationColor>()
	expectTypeOf(ink).toEqualTypeOf<PdfSpotColor>()

	expectTypeOf(grayColor.components).toEqualTypeOf<readonly [number]>()
	expectTypeOf(rgbColor.components).toEqualTypeOf<
		readonly [number, number, number]
	>()
	expectTypeOf(cmykColor.components).toEqualTypeOf<
		readonly [number, number, number, number]
	>()
	expectTypeOf(spotColor.ink).toEqualTypeOf<PdfSpotColor>()
	expectTypeOf(spotColor.tint).toEqualTypeOf<number>()
})

it("retains every individual color type in the public unions", () => {
	expectTypeOf<PdfProcessColor>().toEqualTypeOf<
		PdfGrayColor | PdfRgbColor | PdfCmykColor
	>()
	expectTypeOf<PdfColor>().toEqualTypeOf<
		PdfGrayColor | PdfRgbColor | PdfCmykColor | PdfSeparationColor
	>()
})
