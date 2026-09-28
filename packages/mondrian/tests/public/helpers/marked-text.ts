import {
	array,
	ascii,
	createPdfObjectBuilder,
	dictionary,
	hexString,
	name,
	stream,
} from "mondrian.pdf"
import type { PdfPagesDictionary } from "mondrian.pdf"

/** A delivered document whose visible glyph has different source Unicode. */
export function markedTextDocument(
	namedProperties = false,
	form = false,
	marked = true,
) {
	const objects = createPdfObjectBuilder()
	const properties = objects.add(
		dictionary({
			ActualText: hexString(Uint8Array.of(0xfe, 0xff, 0, 102, 0, 102, 0, 105)),
		}),
	)
	const resources = dictionary({
		Font: dictionary({
			F: objects.add(
				dictionary({
					Type: name("Font"),
					Subtype: name("Type1"),
					BaseFont: name("Helvetica"),
				}),
			),
		}),
		Properties: dictionary({ Text: properties }),
	})
	const start = marked
		? `/Artifact BMC /Span ${namedProperties ? "/Text" : "<< /ActualText <FEFF006600660069> >>"} BDC`
		: ""
	const end = marked ? "EMC EMC" : ""
	const content = stream(
		{},
		ascii(`${start} BT /F 28 Tf 1 0 0 0 k 10 20 Td (X) Tj ET ${end}`),
	)
	const pageResources = form
		? dictionary({
				XObject: dictionary({
					Text: objects.add(
						stream(
							{
								Type: name("XObject"),
								Subtype: name("Form"),
								BBox: array(0, 0, 60, 60),
								Resources: resources,
							},
							content.data,
						),
					),
				}),
			})
		: resources
	const pages = objects.reserve<PdfPagesDictionary>()
	const page = objects.add(
		dictionary({
			Type: name("Page"),
			Parent: pages.ref,
			MediaBox: array(0, 0, 60, 60),
			Resources: pageResources,
			Contents: objects.add(form ? stream({}, ascii("/Text Do")) : content),
		}),
	)
	pages.set(dictionary({ Type: name("Pages"), Kids: array(page), Count: 1 }))
	return objects.build({
		root: objects.add(dictionary({ Type: name("Catalog"), Pages: pages.ref })),
	})
}
