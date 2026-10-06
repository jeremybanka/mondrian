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

/** Fixed geometry, embedded RGB interpretation, and optional inherited Form paint. */
export function vectorIntentDocument(program: string, formProgram?: string) {
	const objects = createPdfObjectBuilder(),
		pages = objects.reserve<PdfPagesDictionary>()
	const resources = dictionary({
		...(program.includes("/RGB") || formProgram?.includes("/RGB")
			? {
					ColorSpace: dictionary({
						RGB: array(
							name("ICCBased"),
							objects.add(stream({ N: 3 }, sourceProfile)),
						),
					}),
				}
			: {}),
		ExtGState: dictionary({
			Absolute: dictionary({ RI: name("AbsoluteColorimetric") }),
			Relative: dictionary({ RI: name("RelativeColorimetric") }),
		}),
		Font: dictionary({
			F: dictionary({
				Type: name("Font"),
				Subtype: name("Type1"),
				BaseFont: name("Helvetica"),
			}),
		}),
		...(formProgram === undefined
			? {}
			: {
					XObject: dictionary({
						Mark: objects.add(
							stream(
								{
									Type: name("XObject"),
									Subtype: name("Form"),
									BBox: array(0, 0, 80, 80),
								},
								ascii(formProgram),
							),
						),
					}),
				}),
	})
	const page = objects.add(
		dictionary({
			Type: name("Page"),
			Parent: pages.ref,
			MediaBox: array(0, 0, 80, 80),
			Resources: resources,
			Contents: objects.add(stream({}, ascii(program))),
		}),
	)
	pages.set(dictionary({ Type: name("Pages"), Kids: array(page), Count: 1 }))
	return objects.build({
		root: objects.add(dictionary({ Type: name("Catalog"), Pages: pages.ref })),
		version: "1.5",
	})
}
