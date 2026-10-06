import { readFileSync } from "node:fs"
import { zlibSync } from "fflate"
import {
	array,
	ascii,
	createPdfObjectBuilder,
	dictionary,
	name,
	stream,
} from "mondrian.pdf"
import type { PdfDocument, PdfPagesDictionary } from "mondrian.pdf"
import type { PreparePdfForPrintOptions } from "mondrian.pdf/print"

export const mixedFixture = (file: string) =>
	Uint8Array.from(readFileSync(new URL(file, import.meta.url)))
export const sourceProfile = mixedFixture("sRGB-v2-micro.icc")
export const destinationProfile = readFileSync(
	new URL("../print-images/CGATS21_CRPC6.icc", import.meta.url),
)

export const printOptions: PreparePdfForPrintOptions = {
	destinationProfile,
	outputCondition: "CGATS21 CRPC6 test condition",
	renderingIntent: "relative-colorimetric",
	objectIntents: "honor",
	blackPointCompensation: true,
	untaggedRgb: "srgb",
	gray: "black-only",
	spots: "preserve",
	processNumbers: "preserve",
	blending: "destination",
}

/** Original photographic package label, with no private artwork or identifiers. */
export function mixedColorDocument(): PdfDocument {
	const objects = createPdfObjectBuilder(),
		pages = objects.reserve<PdfPagesDictionary>()
	const profile = objects.add(
		stream({ N: 3, Filter: name("FlateDecode") }, zlibSync(sourceProfile)),
	)
	const rgbSpace = array(name("ICCBased"), profile)
	const mask = objects.add(
		stream(
			{
				Type: name("XObject"),
				Subtype: name("Image"),
				Width: 809,
				Height: 884,
				BitsPerComponent: 8,
				ColorSpace: name("DeviceGray"),
				Filter: name("FlateDecode"),
				DecodeParms: dictionary({
					Colors: 1,
					Columns: 809,
					BitsPerComponent: 8,
				}),
			},
			zlibSync(mixedFixture("alpha.bin")),
		),
	)
	const image = objects.add(
		stream(
			{
				Type: name("XObject"),
				Subtype: name("Image"),
				Width: 809,
				Height: 884,
				BitsPerComponent: 8,
				ColorSpace: rgbSpace,
				Filter: name("DCTDecode"),
				Intent: name("Perceptual"),
				SMask: mask,
			},
			mixedFixture("photo.jpg"),
		),
	)
	const ink = (inkName: string, full: readonly number[]) =>
		array(
			name("Separation"),
			name(inkName),
			rgbSpace,
			dictionary({
				FunctionType: 2,
				Domain: array(0, 1),
				C0: array(1, 1, 1),
				C1: array(...full),
				N: 1,
			}),
		)
	const content = objects.add(
		stream(
			{},
			ascii(
				"0.04 0.08 0.12 0 k 0 0 360 260 re f /Green cs 0.8 scn 18 22 150 196 re f /Purple cs 0.6 scn 180 22 162 196 re f q 200 0 0 218 80 18 cm /Photo Do Q 0 0 0 1 k BT /F1 18 Tf 20 232 Td (WOODLAND STUDY) Tj ET 0.5 g 18 10 324 2 re f 0.2 0.4 0.6 rg 18 5 324 2 re f",
			),
		),
	)
	const fontBytes = mixedFixture("label.ttf")
	const descriptor = objects.add(
		dictionary({
			Type: name("FontDescriptor"),
			FontName: name("LABELX+MossGeometry"),
			Flags: 32,
			FontBBox: array(-100, -200, 1000, 900),
			ItalicAngle: 0,
			Ascent: 900,
			Descent: -200,
			CapHeight: 700,
			StemV: 58,
			FontFile2: objects.add(
				stream(
					{ Length1: fontBytes.length, Filter: name("FlateDecode") },
					zlibSync(fontBytes),
				),
			),
		}),
	)
	const font = objects.add(
		dictionary({
			Type: name("Font"),
			Subtype: name("TrueType"),
			BaseFont: name("LABELX+MossGeometry"),
			Encoding: name("WinAnsiEncoding"),
			FirstChar: 32,
			LastChar: 90,
			Widths: array(
				...Array.from({ length: 59 }, (_, i) => (i === 0 ? 320 : 580)),
			),
			FontDescriptor: descriptor,
		}),
	)
	const page = objects.add(
		dictionary({
			Type: name("Page"),
			Parent: pages.ref,
			MediaBox: array(0, 0, 360, 260),
			Contents: content,
			Group: dictionary({
				S: name("Transparency"),
				CS: rgbSpace,
				I: false,
				K: false,
			}),
			Resources: dictionary({
				XObject: dictionary({ Photo: image }),
				Font: dictionary({ F1: font }),
				ColorSpace: dictionary({
					Green: ink("Forest Green", [0.2, 0.55, 0.32]),
					Purple: ink("Violet", [0.46, 0.25, 0.75]),
				}),
			}),
		}),
	)
	pages.set(dictionary({ Type: name("Pages"), Count: 1, Kids: array(page) }))
	return objects.build({
		root: objects.add(dictionary({ Type: name("Catalog"), Pages: pages.ref })),
		version: "1.5",
	})
}
