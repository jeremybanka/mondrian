import {
	array,
	ascii,
	createPdfObjectBuilder,
	dictionary,
	name,
	stream,
} from "mondrian.pdf"
import type { PdfPagesDictionary } from "mondrian.pdf"
import { sourceProfile } from "./document.ts"

/** Original opacity/overprint fixture; source alpha and named inks are independent. */
export function opacityGraphicsStateDocument(
	options: { readonly ais?: boolean } = { ais: false },
) {
	const objects = createPdfObjectBuilder(),
		pages = objects.reserve<PdfPagesDictionary>()
	const rgb = array(
		name("ICCBased"),
		objects.add(stream({ N: 3 }, sourceProfile)),
	)
	const alpha = objects.add(
		stream(
			{
				Type: name("XObject"),
				Subtype: name("Image"),
				Width: 4,
				Height: 1,
				BitsPerComponent: 8,
				ColorSpace: name("DeviceGray"),
			},
			Uint8Array.of(0, 64, 128, 255),
		),
	)
	const image = objects.add(
		stream(
			{
				Type: name("XObject"),
				Subtype: name("Image"),
				Width: 4,
				Height: 1,
				BitsPerComponent: 8,
				ColorSpace: rgb,
				SMask: alpha,
			},
			Uint8Array.from({ length: 12 }, (_, i) => [204, 38, 13][i % 3]!),
		),
	)
	const ink = (label: string, full: readonly number[]) =>
		array(
			name("Separation"),
			name(label),
			rgb,
			dictionary({
				FunctionType: 2,
				Domain: array(0, 1),
				C0: array(1, 1, 1),
				C1: array(...full),
				N: 1,
			}),
		)
	const state = (opacity: number, overprint: boolean) =>
		dictionary({
			Type: name("ExtGState"),
			BM: name("Normal"),
			ca: opacity,
			CA: opacity,
			OP: overprint,
			op: overprint,
			OPM: 1,
			SMask: name("None"),
			...(options.ais === undefined ? {} : { AIS: options.ais }),
		})
	const resources = dictionary({
		ColorSpace: dictionary({
			Green: ink("Forest Green", [0.2, 0.55, 0.32]),
			Purple: ink("Violet", [0.46, 0.25, 0.75]),
		}),
		ExtGState: dictionary({
			Opaque: objects.add(state(1, false)),
			Half: objects.add(state(0.5, true)),
		}),
		Font: dictionary({
			F: objects.add(
				dictionary({
					Type: name("Font"),
					Subtype: name("Type1"),
					BaseFont: name("Helvetica"),
				}),
			),
		}),
		XObject: dictionary({ Photo: image }),
	})
	const content = objects.add(
		stream(
			{},
			ascii(
				"/Opaque gs 0.2 0.4 0.6 0.8 k 0 0 80 80 re f /Green cs 0.7 scn 0 0 40 60 re f /Purple cs 0.5 scn 40 0 40 60 re f q /Half gs 80 0 0 40 0 10 cm /Photo Do Q 0 0 0 1 k BT /F 10 Tf 4 68 Td (Opacity proof) Tj ET /Half gs 0.2 0.4 0.6 0 K 2 w 5 5 m 75 5 l S",
			),
		),
	)
	const page = objects.add(
		dictionary({
			Type: name("Page"),
			Parent: pages.ref,
			MediaBox: array(0, 0, 80, 80),
			Resources: resources,
			Contents: content,
			Group: dictionary({
				S: name("Transparency"),
				CS: rgb,
				I: false,
				K: false,
			}),
		}),
	)
	pages.set(dictionary({ Type: name("Pages"), Kids: array(page), Count: 1 }))
	return objects.build({
		root: objects.add(dictionary({ Type: name("Catalog"), Pages: pages.ref })),
		version: "1.5",
	})
}
