// SPDX-License-Identifier: MPL-2.0

import { selectPdfOptionalContent } from "./optional-content-select.ts"
import type {
	PdfOptionalContentGroup,
	PdfOptionalContentGroupOptions,
	PdfOptionalContentConfiguration,
} from "./optional-content.ts"
import {
	createOptionalContentGroup,
	getOptionalContentGroup,
	registerOptionalContentGroups,
} from "./optional-content.ts"
import { assertStructuralContent } from "./processing-step-validation.ts"

import type {
	PdfContent,
	PdfFont,
	PdfGraphicsBuilder,
	PdfImage,
	PdfTextBuilder,
	StandardFontName,
} from "./content.ts"
import {
	createCmykImageHandle,
	createFontHandle,
	createGraphicsContent,
	createImageHandle,
	createRgbImageHandle,
	createTextContent,
	getContentRecord,
	createContainerContent,
	contentUsesFont,
	getFontRecord,
	getImageRecord,
} from "./content.ts"
import { zlibSync } from "fflate"
import { assertCmykProfile, iccColorSpace, sameBytes } from "./icc.ts"
import type {
	PdfBlendingSpace,
	PdfCmykImageData,
	PdfRgbImageData,
	PdfOutputIntent,
} from "./print-image.ts"
import { pdfIntent } from "./rgb-image.ts"
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
	readonly outputIntent?: PdfOutputIntent
	/** RGB handoff and destination CMYK blending are separate authoring choices. */
	readonly blendingSpace?: PdfBlendingSpace
	readonly version?: PdfVersion
	readonly metadata?: PdfMetadata
	readonly id?: readonly [Uint8Array, Uint8Array]
}

export interface PdfDocumentBuilder {
	/** A q/cm/Q content scope; reusable Form content keeps its XObject identity. */
	transform(
		matrix: readonly [number, number, number, number, number, number],
		content: readonly PdfContent[],
	): PdfContent
	optionalContentGroup(
		options: PdfOptionalContentGroupOptions,
	): PdfOptionalContentGroup
	optionalContent(
		group: PdfOptionalContentGroup,
		content: readonly PdfContent[],
	): PdfContent
	setOptionalContentConfiguration(
		configuration: PdfOptionalContentConfiguration,
	): PdfDocumentBuilder
	form(options: {
		readonly bbox: PdfRectangle
		readonly content: readonly PdfContent[]
		readonly matrix?: readonly [number, number, number, number, number, number]
	}): PdfContent
	standardFont(baseFont: StandardFontName): PdfFont
	jpeg(bytes: Uint8Array): PdfImage
	image(data: PdfCmykImageData): PdfImage
	rgbImage(data: PdfRgbImageData): PdfImage
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
	readonly #groups: PdfOptionalContentGroup[] = []
	#optionalConfiguration: PdfOptionalContentConfiguration = { baseState: "ON" }
	readonly #version: PdfVersion
	readonly #metadata: PdfMetadata | undefined
	readonly #id: readonly [Uint8Array, Uint8Array] | undefined
	readonly #outputIntent: PdfOutputIntent | undefined
	readonly #blendingSpace: PdfBlendingSpace | undefined
	#rootChildren: readonly PdfPageTreeNode[] | undefined

	constructor(options: PdfDocumentBuilderOptions) {
		this.#version = options.version ?? "1.7"
		const blend =
			options.blendingSpace ??
			(options.outputIntent === undefined ? undefined : "DeviceCMYK")
		if (blend !== undefined) {
			if (Number(this.#version) < 1.4)
				throw new TypeError("Transparency blending requires PDF 1.4 or later")
			if (blend !== "DeviceCMYK") {
				if (iccColorSpace(blend.rgbProfile) !== "RGB ")
					throw new TypeError("RGB blending requires an RGB ICC profile")
				this.#blendingSpace = { rgbProfile: Uint8Array.from(blend.rgbProfile) }
			} else this.#blendingSpace = blend
		}
		if (options.outputIntent !== undefined) {
			if (["1.0", "1.1", "1.2", "1.3"].includes(this.#version))
				throw new TypeError("Print output intents require PDF 1.4 or later")
			assertCmykProfile(options.outputIntent.profile)
			if (
				typeof options.outputIntent.identifier !== "string" ||
				options.outputIntent.identifier.trim() === ""
			)
				throw new TypeError("An output condition identifier is required")
			this.#outputIntent = Object.freeze({
				profile: Uint8Array.from(options.outputIntent.profile),
				identifier: options.outputIntent.identifier,
			})
		}
		this.#metadata = copyMetadata(options.metadata)
		this.#id =
			options.id === undefined
				? undefined
				: Object.freeze([options.id[0].slice(), options.id[1].slice()])
	}

	transform(
		matrix: readonly [number, number, number, number, number, number],
		content: readonly PdfContent[],
	): PdfContent {
		if (matrix.length !== 6 || matrix.some((value) => !Number.isFinite(value)))
			throw new TypeError("Content matrix must contain six finite numbers")
		return createContainerContent({
			owner: this.#owner,
			kind: "transform",
			content,
			matrix: Object.freeze([...matrix]) as typeof matrix,
		})
	}

	optionalContentGroup(
		options: PdfOptionalContentGroupOptions,
	): PdfOptionalContentGroup {
		if (Number(this.#version) < 1.5)
			throw new TypeError("Optional content requires PDF 1.5 or later")
		const group = createOptionalContentGroup(this.#owner, options)
		this.#groups.push(group)
		return group
	}
	optionalContent(
		group: PdfOptionalContentGroup,
		content: readonly PdfContent[],
	): PdfContent {
		const record = getOptionalContentGroup(group, this.#owner)
		if (record.processingStep)
			assertStructuralContent(content, record.processingStep)
		return createContainerContent({
			owner: this.#owner,
			kind: "optional-content",
			group,
			content,
		})
	}
	setOptionalContentConfiguration(
		configuration: PdfOptionalContentConfiguration,
	): PdfDocumentBuilder {
		if (!["ON", "OFF"].includes(configuration?.baseState))
			throw new TypeError("Optional content baseState must be ON or OFF")
		for (const group of [
			...(configuration.on ?? []),
			...(configuration.off ?? []),
			...(configuration.order ?? []),
		])
			getOptionalContentGroup(group, this.#owner)
		if (
			(configuration.on ?? []).some((group) =>
				configuration.off?.includes(group),
			)
		)
			throw new TypeError("An optional content group cannot be both ON and OFF")
		for (const list of [
			configuration.on,
			configuration.off,
			configuration.order,
		])
			if (list && new Set(list).size !== list.length)
				throw new TypeError("Duplicate optional content group in configuration")
		this.#optionalConfiguration = {
			baseState: configuration.baseState,
			on: [...(configuration.on ?? [])],
			off: [...(configuration.off ?? [])],
			order: [...(configuration.order ?? this.#groups)],
		}
		return this
	}
	form(options: {
		readonly bbox: PdfRectangle
		readonly content: readonly PdfContent[]
		readonly matrix?: readonly [number, number, number, number, number, number]
	}): PdfContent {
		assertRectangle(options.bbox)
		const matrix = options.matrix ?? [1, 0, 0, 1, 0, 0]
		if (matrix.length !== 6 || matrix.some((value) => !Number.isFinite(value)))
			throw new TypeError("Form matrix must contain six finite numbers")
		return createContainerContent({
			owner: this.#owner,
			kind: "form",
			content: options.content,
			bbox: options.bbox,
			matrix: Object.freeze([...matrix]) as typeof matrix,
		})
	}

	standardFont(baseFont: StandardFontName): PdfFont {
		return createFontHandle(this.#owner, baseFont)
	}

	jpeg(bytes: Uint8Array): PdfImage {
		return createImageHandle(this.#owner, bytes)
	}

	rgbImage(data: PdfRgbImageData): PdfImage {
		if (data.alpha !== undefined && this.#blendingSpace === undefined)
			throw new TypeError(
				"Transparent RGB images require an explicit document blendingSpace",
			)
		return createRgbImageHandle(this.#owner, data)
	}

	image(data: PdfCmykImageData): PdfImage {
		if (
			this.#outputIntent === undefined ||
			!(data.destinationProfile instanceof Uint8Array) ||
			!sameBytes(data.destinationProfile, this.#outputIntent.profile)
		)
			throw new TypeError(
				"The image destination profile must match the document output intent",
			)
		return createCmykImageHandle(this.#owner, data)
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
		const groupReferences = new Map<PdfOptionalContentGroup, PdfReference>()
		for (const group of this.#groups) {
			const record = getOptionalContentGroup(group, this.#owner)
			groupReferences.set(
				group,
				objects.add(
					dictionary({
						Type: name("OCG"),
						Name: textString(record.name),
						...(record.processingStep === undefined
							? {}
							: {
									GTS_Metadata: dictionary({
										GTS_ProcStepsGroup: name(record.processingStep.group),
										GTS_ProcStepsType: name(record.processingStep.type),
									}),
								}),
					}),
				),
			)
		}
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

			const mask =
				record.alpha === undefined
					? undefined
					: objects.add(
							stream(
								{
									Type: name("XObject"),
									Subtype: name("Image"),
									Width: record.width,
									Height: record.height,
									ColorSpace: name("DeviceGray"),
									BitsPerComponent: 8,
									Filter: name("FlateDecode"),
								},
								zlibSync(record.alpha),
							),
						)
			const result = objects.add(
				stream(
					{
						Type: name("XObject"),
						Subtype: name("Image"),
						Width: record.width,
						Height: record.height,
						ColorSpace:
							record.encoding === "raw" && record.sourceProfile !== undefined
								? array(
										name("ICCBased"),
										objects.add(
											stream(
												{
													N: 3,
													Alternate: name("DeviceRGB"),
													Filter: name("FlateDecode"),
												},
												zlibSync(record.sourceProfile),
											),
										),
									)
								: name(record.colorSpace),
						BitsPerComponent: record.bitsPerComponent,
						Filter: name(
							record.encoding === "raw" ? "FlateDecode" : "DCTDecode",
						),
						...(mask === undefined ? {} : { SMask: mask }),
						...(record.encoding === "raw" &&
						record.renderingIntent !== undefined
							? { Intent: name(pdfIntent(record.renderingIntent)) }
							: {}),
					},
					record.encoding === "raw" ? zlibSync(record.bytes) : record.bytes,
				),
			)
			imageReferences.set(image, result)
			return result
		}

		const formReferences = new Map<PdfContent, PdfReference>()
		const lowerContent = (
			content: readonly PdfContent[],
			pageStream = false,
		): {
			bytes: Uint8Array
			resources: PdfDictionary
			contents: PdfReference<PdfStream> | undefined
		} => {
			const encoded = encodePageContent(this.#owner, content, objects)
			const contents = pageStream
				? objects.add(stream({}, encoded.bytes))
				: undefined
			const resourceEntries: Record<string, PdfValue | undefined> = {
				...encoded.colorResources.entries,
			}

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

			if (encoded.groups.size)
				resourceEntries.Properties = dictionary(
					Object.fromEntries(
						[...encoded.groups].map(([group, alias]) => [
							alias,
							groupReferences.get(group)!,
						]),
					),
				)
			const xobjects: Record<string, PdfValue | undefined> = {
				...(resourceEntries.XObject as PdfDictionary | undefined)?.entries,
			}
			for (const [form, alias] of encoded.forms) {
				let ref = formReferences.get(form)
				if (!ref) {
					const record = getContentRecord(form)
					if (record.kind !== "form") throw new Error("Expected Form content")
					const nested = lowerContent(record.content)
					ref = objects.add(
						stream(
							{
								Type: name("XObject"),
								Subtype: name("Form"),
								BBox: array(...record.bbox),
								Matrix: array(...record.matrix),
								Resources: nested.resources,
							},
							nested.bytes,
						),
					)
					formReferences.set(form, ref)
				}
				xobjects[alias] = ref
			}
			if (Object.keys(xobjects).length)
				resourceEntries.XObject = dictionary(xobjects)
			return {
				bytes: encoded.bytes,
				resources: dictionary(resourceEntries),
				contents,
			}
		}

		const lowerPage = (
			node: PdfPage,
			parent: PdfReference<PdfPagesDictionary>,
		): PdfReference<PdfPageDictionary> => {
			const record = requirePageRecord(node)
			const page = objects.reserve<PdfPageDictionary>()
			const encoded = lowerContent(record.content, true)
			const contents = encoded.contents!

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
					Resources: encoded.resources,
					...(this.#blendingSpace === undefined
						? {}
						: {
								Group: dictionary({
									S: name("Transparency"),
									CS:
										this.#blendingSpace === "DeviceCMYK"
											? name("DeviceCMYK")
											: array(
													name("ICCBased"),
													objects.add(
														stream(
															{ N: 3, Filter: name("FlateDecode") },
															zlibSync(this.#blendingSpace.rgbProfile),
														),
													),
												),
									I: true,
									K: false,
								}),
							}),
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
		const output = this.#outputIntent
		const outputIntents =
			output === undefined
				? undefined
				: array(
						objects.add(
							dictionary({
								Type: name("OutputIntent"),
								S: name("GTS_PDFX"),
								OutputConditionIdentifier: textString(output.identifier),
								DestOutputProfile: objects.add(
									stream(
										{ N: 4, Filter: name("FlateDecode") },
										zlibSync(output.profile),
									),
								),
							}),
						),
					)
		catalog.set(
			dictionary({
				Type: name("Catalog"),
				...(groupReferences.size === 0
					? {}
					: {
							OCProperties: dictionary({
								OCGs: array(...groupReferences.values()),
								D: dictionary({
									BaseState: name(this.#optionalConfiguration.baseState),
									ON: array(
										...(this.#optionalConfiguration.on ?? []).map((group) =>
											groupReferences.get(group)!,
										),
									),
									OFF: array(
										...(this.#optionalConfiguration.off ?? []).map((group) =>
											groupReferences.get(group)!,
										),
									),
									Order: array(
										...(this.#optionalConfiguration.order ?? this.#groups).map(
											(group) => groupReferences.get(group)!,
										),
									),
								}),
							}),
						}),
				Pages: pages.ref,
				...(outputIntents === undefined
					? {}
					: { OutputIntents: outputIntents }),
			}) satisfies PdfCatalogDictionary,
		)

		const info = this.#lowerInfo(objects)
		const document = objects.build({
			version: this.#version,
			root: catalog.ref,
			...(info === undefined ? {} : { info }),
			...(this.#id === undefined
				? {}
				: {
						id: [hexString(this.#id[0]), hexString(this.#id[1])] as const,
					}),
		})
		registerOptionalContentGroups(document, groupReferences)
		if (groupReferences.size)
			selectPdfOptionalContent(document, { baseState: "ON" })
		return document
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
					record.content.some((content) => contentUsesFont(content))
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
