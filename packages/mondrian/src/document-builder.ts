import type {
	PdfContent,
	PdfFont,
	PdfGraphicsBuilder,
	PdfImage,
	PdfTextBuilder,
	StandardFontName,
} from "./content.ts"
import {
	createFontHandle,
	createGraphicsContent,
	createImageHandle,
	createTextContent,
	getContentRecord,
	getFontRecord,
	getImageRecord,
} from "./content.ts"
import { encodePageContent } from "./content-encode.ts"
import type { PdfDiagnostic } from "./diagnostics.ts"
import { throwForPdfErrors } from "./diagnostics.ts"
import { createPdfObjectBuilder } from "./object-builder.ts"
import type {
	PdfCatalogDictionary,
	PdfDateString,
	PdfDictionary,
	PdfDocument,
	PdfInfoDictionary,
	PdfName,
	PdfPageDictionary,
	PdfPagesDictionary,
	PdfReference,
	PdfStream,
	PdfTextString,
	PdfValue,
	PdfVersion,
} from "./objects.ts"
import {
	array,
	asciiTextString,
	dateString,
	dictionary,
	hexString,
	name,
	stream,
	textString,
} from "./objects.ts"
import { serializePdf } from "./serialize.ts"

declare const rectangleBrand: unique symbol
declare const pageBrand: unique symbol
declare const pagesBrand: unique symbol

export type PdfRectangle = readonly [
	xMin: number,
	yMin: number,
	xMax: number,
	yMax: number,
] & {
	readonly [rectangleBrand]: "PdfRectangle"
}

export interface PdfPage {
	readonly kind: "page"
	readonly [pageBrand]: "PdfPage"
}

export interface PdfPages {
	readonly kind: "pages"
	readonly [pagesBrand]: "PdfPages"
}

export type PdfPageTreeNode = PdfPage | PdfPages

export type PdfPageRotation = 0 | 90 | 180 | 270

export interface PdfPageOptions {
	readonly mediaBox: PdfRectangle
	readonly content?: readonly PdfContent[]
	readonly rotation?: PdfPageRotation
}

export interface PdfMetadata {
	readonly title?: string
	readonly author?: string
	readonly subject?: string
	readonly keywords?: string
	readonly creator?: string
	readonly producer?: string
	readonly creationDate?: Date
	readonly modificationDate?: Date
}

export interface PdfDocumentBuilderOptions {
	readonly version?: PdfVersion
	readonly metadata?: PdfMetadata
	readonly id?: readonly [Uint8Array, Uint8Array]
}

export interface PdfDocumentBuilder {
	standardFont(baseFont: StandardFontName): PdfFont
	jpeg(bytes: Uint8Array): PdfImage
	text(callback: (text: PdfTextBuilder) => void): PdfContent
	graphics(callback: (graphics: PdfGraphicsBuilder) => void): PdfContent
	page(options: PdfPageOptions): PdfPage
	pages(first: PdfPageTreeNode, ...rest: readonly PdfPageTreeNode[]): PdfPages
	setPages(
		first: PdfPageTreeNode,
		...rest: readonly PdfPageTreeNode[]
	): PdfDocumentBuilder
	compile(): PdfDocument
	serialize(): Uint8Array
}

interface PageRecord {
	readonly owner: symbol
	readonly mediaBox: PdfRectangle
	readonly content: readonly PdfContent[]
	readonly rotation: PdfPageRotation
}

interface PagesRecord {
	readonly owner: symbol
	readonly children: readonly PdfPageTreeNode[]
}

const pageRecords = new WeakMap<PdfPage, PageRecord>()
const pagesRecords = new WeakMap<PdfPages, PagesRecord>()

export const pageSizes = Object.freeze({
	letter: rectangle(0, 0, 612, 792),
	legal: rectangle(0, 0, 612, 1_008),
	a4: rectangle(0, 0, 595.28, 841.89),
})

export function rectangle(
	xMin: number,
	yMin: number,
	xMax: number,
	yMax: number,
): PdfRectangle {
	for (const value of [xMin, yMin, xMax, yMax]) {
		if (!Number.isFinite(value)) {
			throw new TypeError("PDF rectangle coordinates must be finite")
		}
	}

	if (xMax <= xMin || yMax <= yMin) {
		throw new RangeError("A PDF rectangle must have positive width and height")
	}

	return Object.freeze([xMin, yMin, xMax, yMax]) as PdfRectangle
}

export function createPdfDocument(
	options: PdfDocumentBuilderOptions = {},
): PdfDocumentBuilder {
	return new DocumentBuilder(options)
}

class DocumentBuilder implements PdfDocumentBuilder {
	readonly #owner = Symbol("PdfDocumentBuilder")
	readonly #version: PdfVersion
	readonly #metadata: PdfMetadata | undefined
	readonly #id: readonly [Uint8Array, Uint8Array] | undefined
	#rootChildren: readonly PdfPageTreeNode[] | undefined

	constructor(options: PdfDocumentBuilderOptions) {
		this.#version = options.version ?? "1.7"
		this.#metadata = copyMetadata(options.metadata)
		this.#id =
			options.id === undefined
				? undefined
				: Object.freeze([options.id[0].slice(), options.id[1].slice()])
	}

	standardFont(baseFont: StandardFontName): PdfFont {
		return createFontHandle(this.#owner, baseFont)
	}

	jpeg(bytes: Uint8Array): PdfImage {
		return createImageHandle(this.#owner, bytes)
	}

	text(callback: (text: PdfTextBuilder) => void): PdfContent {
		return createTextContent(this.#owner, callback)
	}

	graphics(callback: (graphics: PdfGraphicsBuilder) => void): PdfContent {
		return createGraphicsContent(this.#owner, callback)
	}

	page(options: PdfPageOptions): PdfPage {
		if (typeof options !== "object" || options === null) {
			throw new TypeError("PDF page options are required")
		}

		assertRectangle(options.mediaBox)
		const content = Object.freeze([...(options.content ?? [])])
		for (const item of content) {
			if (getContentRecord(item).owner !== this.#owner) {
				throw new TypeError("PDF content belongs to another document builder")
			}
		}

		const rotation = options.rotation ?? 0
		if (![0, 90, 180, 270].includes(rotation)) {
			throw new RangeError("PDF page rotation must be 0, 90, 180, or 270")
		}

		const page = Object.freeze({ kind: "page" }) as PdfPage
		pageRecords.set(
			page,
			Object.freeze({
				owner: this.#owner,
				mediaBox: options.mediaBox,
				content,
				rotation,
			}),
		)
		return page
	}

	pages(first: PdfPageTreeNode, ...rest: readonly PdfPageTreeNode[]): PdfPages {
		const children = Object.freeze([first, ...rest])
		this.#assertOwnedNodes(children)
		const pages = Object.freeze({ kind: "pages" }) as PdfPages
		pagesRecords.set(pages, Object.freeze({ owner: this.#owner, children }))
		return pages
	}

	setPages(
		first: PdfPageTreeNode,
		...rest: readonly PdfPageTreeNode[]
	): PdfDocumentBuilder {
		const children = Object.freeze([first, ...rest])
		this.#assertOwnedNodes(children)
		this.#rootChildren = children
		return this
	}

	compile(): PdfDocument {
		const diagnostics = this.#sourceDiagnostics()
		throwForPdfErrors(diagnostics)
		const rootChildren = this.#rootChildren
		if (rootChildren === undefined) {
			throw new Error("Unreachable: source validation requires a page tree")
		}

		const objects = createPdfObjectBuilder()
		const catalog = objects.reserve<PdfCatalogDictionary>()
		const fontReferences = new Map<PdfFont, PdfReference<PdfDictionary>>()
		const imageReferences = new Map<PdfImage, PdfReference<PdfStream>>()

		const fontReference = (font: PdfFont): PdfReference<PdfDictionary> => {
			const existing = fontReferences.get(font)
			if (existing !== undefined) {
				return existing
			}

			const record = getFontRecord(font)
			if (record.owner !== this.#owner) {
				throw new TypeError("PDF font belongs to another document builder")
			}

			const value = dictionary({
				Type: name("Font"),
				Subtype: name("Type1"),
				BaseFont: name(record.baseFont),
				...(record.baseFont === "Symbol" || record.baseFont === "ZapfDingbats"
					? {}
					: { Encoding: name("WinAnsiEncoding") }),
			})
			const result = objects.add(value)
			fontReferences.set(font, result)
			return result
		}

		const imageReference = (image: PdfImage): PdfReference<PdfStream> => {
			const existing = imageReferences.get(image)
			if (existing !== undefined) {
				return existing
			}

			const record = getImageRecord(image)
			if (record.owner !== this.#owner) {
				throw new TypeError("PDF image belongs to another document builder")
			}

			const result = objects.add(
				stream(
					{
						Type: name("XObject"),
						Subtype: name("Image"),
						Width: record.width,
						Height: record.height,
						ColorSpace: name(record.colorSpace),
						BitsPerComponent: record.bitsPerComponent,
						Filter: name("DCTDecode"),
					},
					record.bytes,
				),
			)
			imageReferences.set(image, result)
			return result
		}

		const lowerPage = (
			node: PdfPage,
			parent: PdfReference<PdfPagesDictionary>,
		): PdfReference<PdfPageDictionary> => {
			const record = requirePageRecord(node)
			const page = objects.reserve<PdfPageDictionary>()
			const encoded = encodePageContent(this.#owner, record.content)
			const contents = objects.add(stream({}, encoded.bytes))
			const resourceEntries: Record<string, PdfValue> = Object.create(null)

			if (encoded.fonts.size > 0) {
				const entries: Record<string, PdfValue> = Object.create(null)
				for (const [font, resourceName] of encoded.fonts) {
					entries[resourceName] = fontReference(font)
				}
				resourceEntries.Font = dictionary(entries)
			}

			if (encoded.images.size > 0) {
				const entries: Record<string, PdfValue> = Object.create(null)
				for (const [image, resourceName] of encoded.images) {
					entries[resourceName] = imageReference(image)
				}
				resourceEntries.XObject = dictionary(entries)
			}

			if (["1.0", "1.1", "1.2", "1.3"].includes(this.#version)) {
				const procSet: PdfName[] = [name("PDF")]
				if (encoded.fonts.size > 0) {
					procSet.push(name("Text"))
				}

				for (const image of encoded.images.keys()) {
					const procedure =
						getImageRecord(image).colorSpace === "DeviceGray"
							? "ImageB"
							: "ImageC"
					if (!procSet.some((item) => item.value === procedure)) {
						procSet.push(name(procedure))
					}
				}

				resourceEntries.ProcSet = array(...procSet)
			}

			page.set(
				dictionary({
					Type: name("Page"),
					Parent: parent,
					MediaBox: array(
						record.mediaBox[0],
						record.mediaBox[1],
						record.mediaBox[2],
						record.mediaBox[3],
					),
					Resources: dictionary(resourceEntries),
					Contents: contents,
					...(record.rotation === 0 ? {} : { Rotate: record.rotation }),
				}) satisfies PdfPageDictionary,
			)
			return page.ref
		}

		const lowerPages = (
			children: readonly PdfPageTreeNode[],
			parent?: PdfReference<PdfPagesDictionary>,
		): {
			readonly ref: PdfReference<PdfPagesDictionary>
			readonly count: number
		} => {
			const pages = objects.reserve<PdfPagesDictionary>()
			let count = 0
			const kids: PdfReference<PdfPageDictionary | PdfPagesDictionary>[] = []

			for (const child of children) {
				if (child.kind === "page") {
					kids.push(lowerPage(child, pages.ref))
					count += 1
				} else {
					const nested = lowerPages(
						requirePagesRecord(child).children,
						pages.ref,
					)
					kids.push(nested.ref)
					count += nested.count
				}
			}

			pages.set(
				dictionary({
					Type: name("Pages"),
					Kids: array(...kids),
					Count: count,
					...(parent === undefined ? {} : { Parent: parent }),
				}) satisfies PdfPagesDictionary,
			)
			return { ref: pages.ref, count }
		}

		const pages = lowerPages(rootChildren)
		catalog.set(
			dictionary({
				Type: name("Catalog"),
				Pages: pages.ref,
			}) satisfies PdfCatalogDictionary,
		)

		const info = this.#lowerInfo(objects)
		return objects.build({
			version: this.#version,
			root: catalog.ref,
			...(info === undefined ? {} : { info }),
			...(this.#id === undefined
				? {}
				: {
						id: [hexString(this.#id[0]), hexString(this.#id[1])] as const,
					}),
		})
	}

	serialize(): Uint8Array {
		return serializePdf(this.compile())
	}

	#lowerInfo(
		objects: ReturnType<typeof createPdfObjectBuilder>,
	): PdfReference<PdfInfoDictionary> | undefined {
		if (this.#metadata === undefined) {
			return undefined
		}

		const entries: Record<string, PdfTextString | PdfDateString | undefined> = {
			Title: optionalText(this.#metadata.title, this.#version),
			Author: optionalText(this.#metadata.author, this.#version),
			Subject: optionalText(this.#metadata.subject, this.#version),
			Keywords: optionalText(this.#metadata.keywords, this.#version),
			Creator: optionalText(this.#metadata.creator, this.#version),
			Producer: optionalText(this.#metadata.producer, this.#version),
			CreationDate: optionalDate(this.#metadata.creationDate),
			ModDate: optionalDate(this.#metadata.modificationDate),
		}
		if (Object.values(entries).every((value) => value === undefined)) {
			return undefined
		}

		return objects.add(dictionary(entries) satisfies PdfInfoDictionary)
	}

	#sourceDiagnostics(): readonly PdfDiagnostic[] {
		if (this.#rootChildren === undefined) {
			return [
				{
					severity: "error",
					code: "missing-page-tree",
					path: "pages",
					message: "Set at least one page-tree node before compiling the PDF",
				},
			]
		}

		const diagnostics: PdfDiagnostic[] = []
		if (this.#version === "1.0" || this.#version === "1.1") {
			for (const [key, value] of Object.entries(this.#metadata ?? {})) {
				if (
					typeof value === "string" &&
					[...value].some((character) => character.codePointAt(0)! > 0x7f)
				) {
					diagnostics.push({
						severity: "error",
						code: "unsupported-version-feature",
						path: `metadata.${key}`,
						message: "Unicode metadata strings require PDF 1.2 or later",
					})
				}
			}
		}
		const firstPaths = new Map<PdfPageTreeNode, string>()
		const visit = (node: PdfPageTreeNode, path: string): void => {
			const firstPath = firstPaths.get(node)
			if (firstPath !== undefined) {
				diagnostics.push({
					severity: "error",
					code: "page-node-reused",
					path,
					message: "A page-tree node can have only one structural parent",
					related: [
						{
							path: firstPath,
							message: "The node was first used here",
						},
					],
				})
				return
			}

			firstPaths.set(node, path)
			if (node.kind === "page") {
				const record = pageRecords.get(node)
				if (record?.owner !== this.#owner) {
					diagnostics.push({
						severity: "error",
						code: "foreign-source",
						path,
						message: "Page-tree node belongs to another document builder",
					})
					return
				}

				if (
					this.#version === "2.0" &&
					record.content.some((content) =>
						getContentRecord(content).operations.some(
							(operation) => operation.op === "font",
						),
					)
				) {
					diagnostics.push({
						severity: "error",
						code: "unsupported-version-feature",
						path: `${path}.content`,
						message:
							"Standard 14 fonts require PDF 1.x; PDF 2.0 fonts must be fully described through the low-level API",
					})
				}
				return
			}

			const record = pagesRecords.get(node)
			if (record?.owner !== this.#owner) {
				diagnostics.push({
					severity: "error",
					code: "foreign-source",
					path,
					message: "Page-tree node belongs to another document builder",
				})
				return
			}

			for (let index = 0; index < record.children.length; index += 1) {
				visit(
					record.children[index] as PdfPageTreeNode,
					`${path}.children[${index}]`,
				)
			}
		}

		for (let index = 0; index < this.#rootChildren.length; index += 1) {
			visit(this.#rootChildren[index] as PdfPageTreeNode, `pages[${index}]`)
		}

		return diagnostics
	}

	#assertOwnedNodes(nodes: readonly PdfPageTreeNode[]): void {
		for (const node of nodes) {
			const record =
				node.kind === "page" ? pageRecords.get(node) : pagesRecords.get(node)
			if (record?.owner !== this.#owner) {
				throw new TypeError(
					"PDF page-tree node belongs to another document builder",
				)
			}
		}
	}
}

function requirePageRecord(page: PdfPage): PageRecord {
	const record = pageRecords.get(page)
	if (record === undefined) {
		throw new TypeError("Unknown PDF page node")
	}

	return record
}

function requirePagesRecord(pages: PdfPages): PagesRecord {
	const record = pagesRecords.get(pages)
	if (record === undefined) {
		throw new TypeError("Unknown PDF Pages node")
	}

	return record
}

function assertRectangle(value: PdfRectangle): void {
	if (!Array.isArray(value) || value.length !== 4) {
		throw new TypeError("A PDF page mediaBox must be created with rectangle()")
	}

	rectangle(
		value[0] as number,
		value[1] as number,
		value[2] as number,
		value[3] as number,
	)
}

function optionalText(
	value: string | undefined,
	version: PdfVersion,
): PdfTextString | undefined {
	if (value === undefined) {
		return undefined
	}

	return version === "1.0" || version === "1.1"
		? asciiTextString(value)
		: textString(value)
}

function optionalDate(value: Date | undefined): PdfDateString | undefined {
	return value === undefined ? undefined : dateString(value)
}

function copyMetadata(
	metadata: PdfMetadata | undefined,
): PdfMetadata | undefined {
	if (metadata === undefined) {
		return undefined
	}

	const creationDate = copyDate(metadata.creationDate, "creationDate")
	const modificationDate = copyDate(
		metadata.modificationDate,
		"modificationDate",
	)
	return Object.freeze({
		...metadata,
		...(creationDate === undefined ? {} : { creationDate }),
		...(modificationDate === undefined ? {} : { modificationDate }),
	})
}

function copyDate(value: Date | undefined, key: string): Date | undefined {
	if (value === undefined) {
		return undefined
	}

	if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
		throw new TypeError(`PDF metadata ${key} must be a valid Date`)
	}
	if (value.getUTCFullYear() < 0 || value.getUTCFullYear() > 9_999) {
		throw new RangeError(
			`PDF metadata ${key} year must fit the four-digit PDF date format`,
		)
	}

	return new Date(value.getTime())
}
