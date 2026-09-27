// SPDX-License-Identifier: MPL-2.0
import { readFileSync } from "node:fs"
import { pdfBytes, WirePdf } from "../wire.ts"
import { group4, jbig2, lzw } from "./encoders.ts"
import {
	colorPixels,
	imageHeight,
	imageWidth,
	lanternPixels,
} from "./pixels.ts"

export const codecFixtures = [
	{
		id: "lossless-jpx",
		filter: "JPXDecode",
		title: "A spectrum for paper moons",
		monochrome: false,
		encoded: () => readFileSync(new URL("color-study.jp2", import.meta.url)),
		parameters: "",
	},
	{
		id: "group4-fax",
		filter: "CCITTFaxDecode",
		title: "Lantern telegram",
		monochrome: true,
		encoded: () => group4(lanternPixels(), imageHeight),
		parameters: `/DecodeParms << /K -1 /Columns ${imageWidth} /Rows ${imageHeight} /BlackIs1 false >>`,
	},
	{
		id: "jbig2-lantern",
		filter: "JBIG2Decode",
		title: "Lantern archive",
		monochrome: true,
		encoded: () => jbig2(lanternPixels(), imageHeight),
		parameters: "",
	},
	...[0, 1].map((earlyChange) => ({
		id: `lzw-early-change-${earlyChange}`,
		filter: "LZWDecode",
		title: `Spectrum ledger ${earlyChange}`,
		monochrome: false,
		encoded: () => lzw(colorPixels(), earlyChange as 0 | 1).bytes,
		parameters: `/DecodeParms << /EarlyChange ${earlyChange} >>`,
	})),
] as const
export type CodecFixture = (typeof codecFixtures)[number]

/** The uncompressed reference and negative controls share the authored pixels/layout. */
export function codecDocument(
	fixture: CodecFixture,
	mode: "encoded" | "raw" | "hidden" | "no-filter" = "encoded",
): Uint8Array {
	const filter =
		mode === "raw" || mode === "no-filter"
			? ""
			: `/Filter /${fixture.filter} ${fixture.parameters}`
	const bytes =
		mode === "raw"
			? fixture.monochrome
				? lanternPixels()
				: colorPixels()
			: fixture.encoded()
	const pdf = new WirePdf("1.7")
		.add(1, "<< /Type /Catalog /Pages 2 0 R >>")
		.add(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
		.add(
			3,
			"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 280] /Resources << /Font << /F1 5 0 R >> /XObject << /Picture 6 0 R >> >> /Contents 4 0 R >>",
		)
		.stream(
			4,
			"",
			`BT /F1 17 Tf 24 250 Td (${fixture.title}) Tj ET\nBT /F1 10 Tf 24 232 Td (An original image from the imaginary Moss Bureau.) Tj ET\n${mode === "hidden" ? "" : "q 192 0 0 192 64 20 cm /Picture Do Q\n"}`,
		)
		.add(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
		.stream(
			6,
			`/Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /${fixture.monochrome ? "DeviceGray" : "DeviceRGB"} /BitsPerComponent ${fixture.monochrome ? 1 : 8} /Interpolate false ${filter}`,
			bytes,
		)
	return pdfBytes(pdf.write())
}
