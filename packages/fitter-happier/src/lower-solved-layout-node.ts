import type { SolvedNode } from "fitter-happier"
import type {
	PdfCatalogDictionary,
	PdfDocument,
	PdfInfoDictionary,
	PdfMetadata,
	PdfPageDictionary,
	PdfPagesDictionary,
	PdfReference,
	PdfValue,
	PdfVersion,
} from "mondrian.pdf"
import {
	array,
	ascii,
	createPdfObjectBuilder,
	dateString,
	dictionary,
	hexString,
	name,
	stream,
	textString,
} from "mondrian.pdf"
import type { LayoutNodePdfDiagnostic } from "./diagnostics.ts"
import { throwForLayoutNodePdfErrors } from "./diagnostics.ts"
import { renderSolvedLayout } from "./render.ts"

export interface SolvedLayoutNodePdfOptions {
	readonly id?: readonly [Uint8Array, Uint8Array]
	readonly metadata?: PdfMetadata
	readonly version?: PdfVersion
}

export interface LayoutNodePdfLowering {
	readonly diagnostics: readonly LayoutNodePdfDiagnostic[]
	readonly document: PdfDocument
}

/**
 * Lowers solved fitter-happier geometry into mondrian.pdf's object graph.
 * Serialization deliberately belongs to the caller.
 */
export function lowerSolvedLayoutNodeToPdf(
	root: SolvedNode,
	options: SolvedLayoutNodePdfOptions = {},
): LayoutNodePdfLowering {
	const version = options.version ?? "1.7"
	const rendered = renderSolvedLayout(root, version)
	throwForLayoutNodePdfErrors(rendered.diagnostics)

	const objects = createPdfObjectBuilder()
	const pages = objects.reserve<PdfPagesDictionary>()
	const resourceEntries: Record<string, PdfValue> = Object.create(null)

	if (rendered.fonts.length > 0) {
		const entries: Record<string, PdfValue> = Object.create(null)
		for (const font of rendered.fonts) {
			entries[font.name] = objects.add(
				dictionary({
					Type: name("Font"),
					Subtype: name("Type1"),
					BaseFont: name(font.baseFont),
					...(font.baseFont === "Symbol" || font.baseFont === "ZapfDingbats"
						? {}
						: { Encoding: name("WinAnsiEncoding") }),
				}),
			)
		}
		resourceEntries.Font = dictionary(entries)
	}

	if (rendered.images.length > 0) {
		const entries: Record<string, PdfValue> = Object.create(null)
		for (const resource of rendered.images) {
			entries[resource.name] = objects.add(
				stream(
					{
						Type: name("XObject"),
						Subtype: name("Image"),
						Width: resource.image.width,
						Height: resource.image.height,
						ColorSpace: name(resource.image.colorSpace),
						BitsPerComponent: resource.image.bitsPerComponent,
						Filter: name("DCTDecode"),
					},
					resource.image.bytes,
				),
			)
		}
		resourceEntries.XObject = dictionary(entries)
	}

	if (rendered.opacities.length > 0) {
		const entries: Record<string, PdfValue> = Object.create(null)
		for (const opacity of rendered.opacities) {
			entries[opacity.name] = objects.add(
				dictionary({
					Type: name("ExtGState"),
					ca: opacity.alpha,
					CA: opacity.alpha,
				}),
			)
		}
		resourceEntries.ExtGState = dictionary(entries)
	}

	if (["1.0", "1.1", "1.2", "1.3"].includes(version)) {
		const procedures: PdfValue[] = [name("PDF")]
		if (rendered.fonts.length > 0) procedures.push(name("Text"))
		if (
			rendered.images.some(
				(resource) => resource.image.colorSpace === "DeviceGray",
			)
		) {
			procedures.push(name("ImageB"))
		}
		if (
			rendered.images.some(
				(resource) => resource.image.colorSpace === "DeviceRGB",
			)
		) {
			procedures.push(name("ImageC"))
		}
		resourceEntries.ProcSet = array(...procedures)
	}

	const contents = objects.add(stream({}, ascii(rendered.content)))
	const page = objects.add(
		dictionary({
			Type: name("Page"),
			Parent: pages.ref,
			MediaBox: array(0, 0, rendered.pageWidth, rendered.pageHeight),
			Resources: dictionary(resourceEntries),
			Contents: contents,
		}) satisfies PdfPageDictionary,
	)
	pages.set(
		dictionary({
			Type: name("Pages"),
			Kids: array(page),
			Count: 1,
		}) satisfies PdfPagesDictionary,
	)
	const catalog = objects.add(
		dictionary({
			Type: name("Catalog"),
			Pages: pages.ref,
		}) satisfies PdfCatalogDictionary,
	)
	const info = lowerInfo(options.metadata, objects)
	const id =
		options.id ??
		(version === "2.0"
			? deriveDocumentId(
					`${rendered.pageWidth}x${rendered.pageHeight}\n${rendered.content}`,
				)
			: undefined)
	const document = objects.build({
		version,
		root: catalog,
		...(info === undefined ? {} : { info }),
		...(id === undefined
			? {}
			: { id: [hexString(id[0]), hexString(id[1])] as const }),
	})
	return {
		diagnostics: rendered.diagnostics,
		document,
	}
}

function deriveDocumentId(value: string): readonly [Uint8Array, Uint8Array] {
	const result = new Uint8Array(16)
	const hashes = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35]
	for (let index = 0; index < value.length; index += 1) {
		const codeUnit = value.charCodeAt(index)
		for (let hashIndex = 0; hashIndex < hashes.length; hashIndex += 1) {
			const current = hashes[hashIndex] ?? 0
			hashes[hashIndex] = Math.imul(current ^ codeUnit ^ hashIndex, 0x01000193)
		}
	}
	for (let index = 0; index < hashes.length; index += 1) {
		const hash = hashes[index] ?? 0
		result[index * 4] = hash >>> 24
		result[index * 4 + 1] = (hash >>> 16) & 0xff
		result[index * 4 + 2] = (hash >>> 8) & 0xff
		result[index * 4 + 3] = hash & 0xff
	}
	return [result, result.slice()]
}

function lowerInfo(
	metadata: PdfMetadata | undefined,
	objects: ReturnType<typeof createPdfObjectBuilder>,
): PdfReference<PdfInfoDictionary> | undefined {
	if (metadata === undefined) return undefined
	const entries = {
		...(metadata.title === undefined
			? {}
			: { Title: textString(metadata.title) }),
		...(metadata.author === undefined
			? {}
			: { Author: textString(metadata.author) }),
		...(metadata.subject === undefined
			? {}
			: { Subject: textString(metadata.subject) }),
		...(metadata.keywords === undefined
			? {}
			: { Keywords: textString(metadata.keywords) }),
		...(metadata.creator === undefined
			? {}
			: { Creator: textString(metadata.creator) }),
		...(metadata.producer === undefined
			? {}
			: { Producer: textString(metadata.producer) }),
		...(metadata.creationDate === undefined
			? {}
			: { CreationDate: dateString(metadata.creationDate) }),
		...(metadata.modificationDate === undefined
			? {}
			: { ModDate: dateString(metadata.modificationDate) }),
	}
	return objects.add(dictionary(entries) satisfies PdfInfoDictionary)
}
