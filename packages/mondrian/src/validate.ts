import type {
	PdfArray,
	PdfDictionary,
	PdfDictionaryByteEntry,
	PdfDictionaryEntries,
	PdfDocument,
	PdfIndirectObject,
	PdfReference,
	PdfStream,
	PdfValue,
	PdfVersion,
} from "./objects.ts"
import { documentOwner, referenceOwner } from "./ownership.ts"
import { encodePdfName, encodePdfNameBytes, isPdfName } from "./syntax.ts"
import type { PdfDiagnostic, PdfDiagnosticCode } from "./diagnostics.ts"

const versions = new Set([
	"1.0",
	"1.1",
	"1.2",
	"1.3",
	"1.4",
	"1.5",
	"1.6",
	"1.7",
	"2.0",
])

interface ReferenceUse {
	readonly reference: PdfReference
	readonly path: string
}

interface ValidationContext {
	readonly diagnostics: PdfDiagnostic[]
	readonly references: ReferenceUse[]
	readonly activeDirectObjects: Set<object>
	readonly owner: symbol | undefined
	readonly version: PdfVersion
}

export function validatePdf(document: PdfDocument): readonly PdfDiagnostic[] {
	const diagnostics: PdfDiagnostic[] = []
	if (typeof document !== "object" || document === null) {
		return [
			{
				severity: "error",
				code: "invalid-object",
				path: "document",
				message: "A PDF document must be an object",
			},
		]
	}

	const references: ReferenceUse[] = []
	const owner = documentOwner(document)
	const context: ValidationContext = {
		diagnostics,
		references,
		activeDirectObjects: new Set(),
		owner,
		version: document.version,
	}

	if (!versions.has(document.version)) {
		add(
			context,
			"invalid-version",
			"version",
			`Unsupported PDF version: ${String(document.version)}`,
		)
	}

	const objects = new Map<number, PdfIndirectObject>()
	const documentObjects = Array.isArray(document.objects)
		? document.objects
		: []
	if (!Array.isArray(document.objects)) {
		add(
			context,
			"invalid-object",
			"objects",
			"A PDF document objects field must be an array",
		)
	}

	for (let index = 0; index < documentObjects.length; index += 1) {
		const object = documentObjects[index]
		const path = `objects[${index}]`
		if (typeof object !== "object" || object === null) {
			add(
				context,
				"invalid-object",
				path,
				"An indirect PDF object must be an object",
			)
			continue
		}

		if (!isObjectNumber(object.objectNumber)) {
			add(
				context,
				"invalid-object-number",
				`${path}.objectNumber`,
				"An object number must be a positive safe integer",
			)
			continue
		}

		if (!isGenerationNumber(object.generation)) {
			add(
				context,
				"invalid-generation-number",
				`${path}.generation`,
				"A generation number must be an integer from 0 through 65534",
			)
		}

		if (objects.has(object.objectNumber)) {
			add(
				context,
				"duplicate-object-number",
				`${path}.objectNumber`,
				`Object ${object.objectNumber} is defined more than once`,
			)
		} else {
			objects.set(object.objectNumber, object)
		}

		validateValue(object.value, `${path}.value`, context, true)
	}

	let highestObjectNumber = 0
	for (const number of objects.keys()) {
		highestObjectNumber = Math.max(highestObjectNumber, number)
	}
	if (highestObjectNumber - objects.size > 1_000_000) {
		add(
			context,
			"excessive-xref-gaps",
			"objects",
			"The classic cross-reference table cannot contain more than 1000000 object-number gaps",
		)
	}

	if (isReference(document.root)) {
		validateReference(document.root, "root", context)
	} else {
		add(
			context,
			"invalid-root",
			"root",
			"The document root must be an indirect reference",
		)
	}
	if (document.info !== undefined) {
		if (isReference(document.info)) {
			validateReference(document.info, "info", context)
		} else {
			add(
				context,
				"invalid-reference",
				"info",
				"Info must be an indirect reference",
			)
		}
	}

	if (document.id !== undefined) {
		if (
			!Array.isArray(document.id) ||
			document.id.length !== 2 ||
			document.id[0]?.kind !== "hex-string" ||
			document.id[1]?.kind !== "hex-string"
		) {
			add(
				context,
				"invalid-document-id",
				"id",
				"A document ID must contain exactly two hexadecimal strings",
			)
		} else {
			validateValue(document.id[0], "id[0]", context)
			validateValue(document.id[1], "id[1]", context)
		}
	}

	if (document.version === "2.0") {
		if (document.id === undefined) {
			add(
				context,
				"invalid-document-id",
				"id",
				"PDF 2.0 requires a document ID",
			)
		} else if (
			Array.isArray(document.id) &&
			document.id[0]?.kind === "hex-string" &&
			document.id[1]?.kind === "hex-string" &&
			document.id[0].bytes instanceof Uint8Array &&
			document.id[1].bytes instanceof Uint8Array &&
			(document.id[0].bytes.length < 16 || document.id[1].bytes.length < 16)
		) {
			add(
				context,
				"invalid-document-id",
				"id",
				"PDF 2.0 document ID strings must contain at least 16 bytes",
			)
		}
	}

	if (document.version === "1.0" && document.id !== undefined) {
		add(
			context,
			"unsupported-version-feature",
			"id",
			"Document IDs require PDF 1.1 or later",
		)
	}

	for (const { reference, path } of references) {
		const target = objects.get(reference.objectNumber)
		if (target === undefined) {
			add(
				context,
				"invalid-reference",
				path,
				`Reference targets missing object ${reference.objectNumber}`,
			)
		} else if (target.generation !== reference.generation) {
			add(
				context,
				"reference-generation-mismatch",
				path,
				`Reference generation ${reference.generation} does not match object ${reference.objectNumber} generation ${target.generation}`,
			)
		}
	}

	if (isReference(document.info)) {
		const info = resolveMatching(document.info, objects)
		if (info !== undefined && !isDictionary(info.value)) {
			add(
				context,
				"incorrect-reference-target",
				"info",
				"Info must reference a dictionary",
			)
		} else if (info !== undefined && isDictionary(info.value)) {
			validateInfoDictionary(info.value, context)
		}
	}

	validateRootAndPageTree(document, objects, context)
	markUnreachableObjects(document, objects, context)

	return diagnostics
}

function validateValue(
	value: PdfValue | PdfStream,
	path: string,
	context: ValidationContext,
	allowStream = false,
): void {
	if (value === null || typeof value === "boolean") {
		return
	}

	if (typeof value === "number") {
		if (
			!Number.isFinite(value) ||
			(Number.isInteger(value) && !Number.isSafeInteger(value))
		) {
			add(
				context,
				"invalid-number",
				path,
				"A PDF number must be finite and integer values must be safe integers",
			)
		}

		return
	}

	if (typeof value !== "object") {
		add(context, "invalid-object", path, "Value is not a PDF object")
		return
	}

	if (value.kind === "reference") {
		validateReference(value, path, context)
		return
	}

	if (context.activeDirectObjects.has(value)) {
		add(
			context,
			"direct-object-cycle",
			path,
			"Direct PDF objects cannot contain cycles; use an indirect reference",
		)
		return
	}

	context.activeDirectObjects.add(value)
	try {
		if (value.kind === "stream" && !allowStream) {
			add(
				context,
				"stream-must-be-indirect",
				path,
				"A PDF stream must be the value of an indirect object",
			)
		}

		switch (value.kind) {
			case "name":
				validateName(value.value, path, context)
				break
			case "byte-name":
				validateByteName(value, path, context)
				break
			case "literal-string":
			case "hex-string":
				if (!(value.bytes instanceof Uint8Array)) {
					add(
						context,
						"invalid-byte-string",
						`${path}.bytes`,
						"A PDF byte string must contain a Uint8Array",
					)
				}
				break
			case "array":
				if (!Array.isArray(value.items)) {
					add(
						context,
						"invalid-object",
						`${path}.items`,
						"A PDF array must contain an array of PDF values",
					)
					break
				}

				for (let index = 0; index < value.items.length; index += 1) {
					validateValue(
						value.items[index] as PdfValue,
						`${path}[${index}]`,
						context,
					)
				}
				break
			case "dictionary":
				validateEntries(value.entries, value.byteEntries, path, context)
				break
			case "stream":
				if (isRecord(value.entries) && Object.hasOwn(value.entries, "Length")) {
					add(
						context,
						"stream-length-is-derived",
						`${path}.Length`,
						"Stream Length is derived during serialization",
					)
				}
				if (
					Array.isArray(value.byteEntries) &&
					value.byteEntries.some(
						(entry) =>
							Array.isArray(entry) &&
							entry.length === 2 &&
							trySerializedName(entry[0]) === "/Length",
					)
				) {
					add(
						context,
						"stream-length-is-derived",
						`${path}.Length`,
						"Stream Length is derived during serialization",
					)
				}

				if (!(value.data instanceof Uint8Array)) {
					add(
						context,
						"invalid-stream",
						`${path}.data`,
						"A PDF stream must contain a Uint8Array",
					)
				}

				validateEntries(value.entries, value.byteEntries, path, context)
				break
			default:
				add(context, "invalid-object", path, "Unknown PDF object kind")
		}
	} finally {
		context.activeDirectObjects.delete(value)
	}
}

function validateReference(
	reference: PdfReference,
	path: string,
	context: ValidationContext,
): void {
	if (!isObjectNumber(reference.objectNumber)) {
		add(
			context,
			"invalid-object-number",
			`${path}.objectNumber`,
			"A referenced object number must be a positive safe integer",
		)
	}

	if (!isGenerationNumber(reference.generation)) {
		add(
			context,
			"invalid-generation-number",
			`${path}.generation`,
			"A referenced generation must be an integer from 0 through 65534",
		)
	}

	if (
		context.owner !== undefined &&
		referenceOwner(reference) !== context.owner
	) {
		add(
			context,
			"foreign-reference",
			path,
			"Reference does not belong to this PDF object builder",
		)
	}

	context.references.push({ reference, path })
}

function validateEntries(
	entries: PdfDictionaryEntries,
	byteEntries: readonly PdfDictionaryByteEntry[] | undefined,
	path: string,
	context: ValidationContext,
): void {
	if (!isRecord(entries)) {
		add(
			context,
			"invalid-dictionary",
			`${path}.entries`,
			"A PDF dictionary must contain a plain entry record",
		)
		return
	}

	const seen = new Set<string>()
	for (const [key, value] of Object.entries(entries)) {
		validateName(key, `${path}.${key}`, context, "invalid-dictionary-key")
		const serialized = trySerializedName({ kind: "name", value: key })
		if (serialized !== undefined) {
			seen.add(serialized)
		}
		if (value !== undefined) {
			validateValue(value, `${path}.${key}`, context)
		}
	}

	if (byteEntries === undefined) {
		return
	}

	if (!Array.isArray(byteEntries)) {
		add(
			context,
			"invalid-dictionary",
			`${path}.byteEntries`,
			"PDF dictionary byte entries must be an array",
		)
		return
	}

	for (let index = 0; index < byteEntries.length; index += 1) {
		const entry = byteEntries[index]
		const entryPath = `${path}.byteEntries[${index}]`
		if (!Array.isArray(entry) || entry.length !== 2) {
			add(
				context,
				"invalid-dictionary",
				entryPath,
				"A PDF dictionary byte entry must be a key-value tuple",
			)
			continue
		}

		const key: unknown = entry[0]
		const value = entry[1] as PdfValue
		if (
			typeof key === "object" &&
			key !== null &&
			(key as { readonly kind?: unknown }).kind === "name"
		) {
			validateName(
				(key as { readonly value?: unknown }).value,
				`${entryPath}.key`,
				context,
			)
		} else if (
			typeof key === "object" &&
			key !== null &&
			(key as { readonly kind?: unknown }).kind === "byte-name"
		) {
			validateByteName(key, `${entryPath}.key`, context)
		} else {
			add(
				context,
				"invalid-name",
				`${entryPath}.key`,
				"A PDF dictionary byte entry key must be a PDF name",
			)
		}

		const serialized = trySerializedName(key)
		if (serialized !== undefined) {
			if (seen.has(serialized)) {
				add(
					context,
					"duplicate-dictionary-key",
					entryPath,
					`Dictionary key ${serialized} is defined more than once`,
				)
			} else {
				seen.add(serialized)
			}
		}
		validateValue(value, `${entryPath}.value`, context)
	}
}

function validateByteName(
	value: unknown,
	path: string,
	context: ValidationContext,
): void {
	if (
		typeof value !== "object" ||
		value === null ||
		(value as { readonly kind?: unknown }).kind !== "byte-name" ||
		!((value as { readonly bytes?: unknown }).bytes instanceof Uint8Array)
	) {
		add(context, "invalid-name", path, "A PDF byte name must contain bytes")
		return
	}

	const bytes = (value as { readonly bytes: Uint8Array }).bytes
	if (bytes.length === 0 || bytes.includes(0)) {
		add(
			context,
			"invalid-name",
			path,
			"A PDF byte name must be nonempty and cannot contain NUL",
		)
		return
	}

	const encoded = encodePdfNameBytes(bytes)
	if (
		(context.version === "1.0" || context.version === "1.1") &&
		encoded.includes("#")
	) {
		add(
			context,
			"unsupported-version-feature",
			path,
			"Escaped PDF names require PDF 1.2 or later",
		)
	}
}

function trySerializedName(value: unknown): string | undefined {
	if (typeof value !== "object" || value === null) {
		return undefined
	}

	const kind = (value as { readonly kind?: unknown }).kind
	if (kind === "name") {
		const nameValue = (value as { readonly value?: unknown }).value
		if (typeof nameValue !== "string") {
			return undefined
		}

		try {
			return encodePdfName(nameValue)
		} catch {
			return undefined
		}
	}

	if (kind === "byte-name") {
		const bytes = (value as { readonly bytes?: unknown }).bytes
		return bytes instanceof Uint8Array ? encodePdfNameBytes(bytes) : undefined
	}

	return undefined
}

function validateName(
	value: unknown,
	path: string,
	context: ValidationContext,
	code: PdfDiagnosticCode = "invalid-name",
): void {
	if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
		add(context, code, path, "A PDF name must be a nonempty string without NUL")
		return
	}

	try {
		const encoded = encodePdfName(value)
		if (
			(context.version === "1.0" || context.version === "1.1") &&
			encoded.includes("#")
		) {
			add(
				context,
				"unsupported-version-feature",
				path,
				"Escaped PDF names require PDF 1.2 or later",
			)
		}
	} catch (error) {
		add(
			context,
			code,
			path,
			error instanceof Error ? error.message : "Invalid PDF name",
		)
	}
}

function validateRootAndPageTree(
	document: PdfDocument,
	objects: ReadonlyMap<number, PdfIndirectObject>,
	context: ValidationContext,
): void {
	if (!isReference(document.root)) {
		return
	}

	const root = resolve(document.root, objects)
	if (root === undefined || root.generation !== document.root.generation) {
		return
	}

	if (
		!isDictionary(root.value) ||
		!isPdfName(root.value.entries.Type, "Catalog")
	) {
		add(
			context,
			"invalid-root",
			"root",
			"The document root must reference a Catalog dictionary",
		)
		return
	}

	const pages = root.value.entries.Pages
	if (!isReference(pages)) {
		add(
			context,
			"invalid-root",
			"root.Pages",
			"The Catalog Pages entry must be an indirect reference",
		)
		return
	}

	const active = new Set<number>()
	const parents = new Map<number, string>()
	validatePageTreeNode(
		pages,
		undefined,
		"pages",
		objects,
		context,
		active,
		parents,
		false,
		false,
	)
}

function validateInfoDictionary(
	info: PdfDictionary,
	context: ValidationContext,
): void {
	for (const [key, value] of Object.entries(info.entries)) {
		if (value === undefined) {
			continue
		}
		validateInfoValue(key, value, `info.${key}`, context)
	}

	if (!Array.isArray(info.byteEntries)) {
		return
	}

	for (let index = 0; index < info.byteEntries.length; index += 1) {
		const entry = info.byteEntries[index]
		if (!Array.isArray(entry) || entry.length !== 2) {
			continue
		}

		const serialized = trySerializedName(entry[0])
		if (serialized === undefined) {
			continue
		}

		validateInfoValue(
			serialized.slice(1),
			entry[1],
			`info.byteEntries[${index}].value`,
			context,
		)
	}
}

function validateInfoValue(
	key: string,
	value: PdfValue,
	path: string,
	context: ValidationContext,
): void {
	if (key === "Trapped") {
		if (
			!isPdfName(value) ||
			!new Set(["True", "False", "Unknown"]).has(value.value)
		) {
			add(
				context,
				"invalid-info",
				path,
				"Info Trapped must be the name True, False, or Unknown",
			)
		}
		return
	}

	if (
		typeof value !== "object" ||
		value === null ||
		(value.kind !== "literal-string" && value.kind !== "hex-string") ||
		!(value.bytes instanceof Uint8Array)
	) {
		add(
			context,
			"invalid-info",
			path,
			"Info dictionary values must be text strings, except for Trapped",
		)
		return
	}

	if (key === "CreationDate" || key === "ModDate") {
		if (!isValidPdfDate(value.bytes)) {
			add(
				context,
				"invalid-info",
				path,
				"Info date values must use PDF date-string syntax",
			)
		}
		return
	}

	if (!hasValidUnicodeEncoding(value.bytes)) {
		add(context, "invalid-info", path, "Info text string encoding is invalid")
	} else if (
		(context.version === "1.0" || context.version === "1.1") &&
		value.bytes[0] === 0xfe &&
		value.bytes[1] === 0xff
	) {
		add(
			context,
			"unsupported-version-feature",
			path,
			"Unicode text strings require PDF 1.2 or later",
		)
	}
}

function hasValidUnicodeEncoding(bytes: Uint8Array): boolean {
	if (bytes[0] !== 0xfe || bytes[1] !== 0xff) {
		return !(bytes[0] === 0xff && bytes[1] === 0xfe)
	}

	if (bytes.length % 2 !== 0) {
		return false
	}

	for (let offset = 2; offset < bytes.length; offset += 2) {
		const codeUnit =
			((bytes[offset] as number) << 8) | (bytes[offset + 1] as number)
		if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
			if (offset + 3 >= bytes.length) {
				return false
			}

			const next =
				((bytes[offset + 2] as number) << 8) | (bytes[offset + 3] as number)
			if (next < 0xdc00 || next > 0xdfff) {
				return false
			}
			offset += 2
		} else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
			return false
		}
	}

	return true
}

function isValidPdfDate(bytes: Uint8Array): boolean {
	let value = ""
	for (const byte of bytes) {
		if (byte > 0x7f) {
			return false
		}
		value += String.fromCharCode(byte)
	}

	const match =
		/^D:(\d{4})(?:(\d{2})(?:(\d{2})(?:(\d{2})(?:(\d{2})(?:(\d{2}))?)?)?)?)?(Z|[+-](\d{2})'(\d{2})'?)?$/.exec(
			value,
		)
	if (match === null) {
		return false
	}

	const year = Number(match[1])
	const month = optionalNumber(match[2])
	const day = optionalNumber(match[3])
	const hour = optionalNumber(match[4])
	const minute = optionalNumber(match[5])
	const second = optionalNumber(match[6])
	const offsetHour = optionalNumber(match[8])
	const offsetMinute = optionalNumber(match[9])
	if (month !== undefined && (month < 1 || month > 12)) {
		return false
	}
	if (day !== undefined && (day < 1 || day > daysInMonth(year, month ?? 1))) {
		return false
	}

	return (
		(hour === undefined || (hour >= 0 && hour <= 23)) &&
		(minute === undefined || (minute >= 0 && minute <= 59)) &&
		(second === undefined || (second >= 0 && second <= 59)) &&
		(offsetHour === undefined || (offsetHour >= 0 && offsetHour <= 23)) &&
		(offsetMinute === undefined || (offsetMinute >= 0 && offsetMinute <= 59))
	)
}

function optionalNumber(value: string | undefined): number | undefined {
	return value === undefined ? undefined : Number(value)
}

function daysInMonth(year: number, month: number): number {
	if (month === 2) {
		return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28
	}

	return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function validatePageTreeNode(
	reference: PdfReference,
	parent: PdfReference | undefined,
	path: string,
	objects: ReadonlyMap<number, PdfIndirectObject>,
	context: ValidationContext,
	active: Set<number>,
	parents: Map<number, string>,
	inheritedMediaBox: boolean,
	inheritedResources: boolean,
): number | undefined {
	const existingPath = parents.get(reference.objectNumber)
	if (existingPath !== undefined) {
		add(
			context,
			active.has(reference.objectNumber)
				? "page-tree-cycle"
				: "page-tree-node-reused",
			path,
			active.has(reference.objectNumber)
				? "The page tree contains a cycle"
				: "A page-tree node has more than one structural parent",
			[{ path: existingPath, message: "The node was first reached here" }],
		)
		return undefined
	}

	parents.set(reference.objectNumber, path)
	active.add(reference.objectNumber)
	try {
		const object = resolve(reference, objects)
		if (object === undefined || !isDictionary(object.value)) {
			add(
				context,
				"invalid-page-tree",
				path,
				"A page-tree reference must target a dictionary",
			)
			return undefined
		}

		const entries = object.value.entries
		if (isPdfName(entries.Type, "Page")) {
			if (parent === undefined || !sameReference(entries.Parent, parent)) {
				add(
					context,
					"incorrect-page-parent",
					`${path}.Parent`,
					"A Page Parent must reference its immediate Pages node",
				)
			}

			validateLeafPage(
				entries,
				path,
				objects,
				context,
				inheritedMediaBox,
				inheritedResources,
			)

			return 1
		}

		if (!isPdfName(entries.Type, "Pages")) {
			add(
				context,
				"invalid-page-tree",
				`${path}.Type`,
				"A page-tree node must have Type Page or Pages",
			)
			return undefined
		}

		if (parent === undefined) {
			if (entries.Parent !== undefined) {
				add(
					context,
					"incorrect-page-parent",
					`${path}.Parent`,
					"The root Pages node cannot have a Parent",
				)
			}
		} else if (!sameReference(entries.Parent, parent)) {
			add(
				context,
				"incorrect-page-parent",
				`${path}.Parent`,
				"A nested Pages Parent must reference its immediate Pages node",
			)
		}

		if (!isPdfArray(entries.Kids)) {
			add(
				context,
				"invalid-page-tree",
				`${path}.Kids`,
				"A Pages Kids entry must be an array of indirect references",
			)
			return undefined
		}

		const hasMediaBox = validateInheritedRectangle(
			entries.MediaBox,
			`${path}.MediaBox`,
			context,
			inheritedMediaBox,
		)
		const hasResources = validateInheritedResources(
			entries.Resources,
			`${path}.Resources`,
			objects,
			context,
			inheritedResources,
		)
		validateRotation(entries.Rotate, `${path}.Rotate`, context)

		let count = 0
		let complete = true
		for (let index = 0; index < entries.Kids.items.length; index += 1) {
			const child = entries.Kids.items[index]
			if (!isReference(child)) {
				add(
					context,
					"invalid-page-tree",
					`${path}.Kids[${index}]`,
					"Every Pages child must be an indirect reference",
				)
				complete = false
				continue
			}

			const childCount = validatePageTreeNode(
				child,
				reference,
				`${path}.Kids[${index}]`,
				objects,
				context,
				active,
				parents,
				hasMediaBox,
				hasResources,
			)
			if (childCount === undefined) {
				complete = false
			} else {
				count += childCount
			}
		}

		if (
			complete &&
			(!Number.isSafeInteger(entries.Count) || entries.Count !== count)
		) {
			add(
				context,
				"incorrect-page-count",
				`${path}.Count`,
				`Pages Count is ${String(entries.Count)} but the subtree contains ${count} pages`,
			)
		}

		return complete ? count : undefined
	} finally {
		active.delete(reference.objectNumber)
	}
}

function validateLeafPage(
	entries: PdfDictionaryEntries,
	path: string,
	objects: ReadonlyMap<number, PdfIndirectObject>,
	context: ValidationContext,
	inheritedMediaBox: boolean,
	inheritedResources: boolean,
): void {
	if (entries.MediaBox === undefined) {
		if (!inheritedMediaBox) {
			add(
				context,
				"missing-page-attribute",
				`${path}.MediaBox`,
				"A Page must have a direct or inherited MediaBox",
			)
		}
	} else if (!isRectangle(entries.MediaBox)) {
		add(
			context,
			"invalid-page-tree",
			`${path}.MediaBox`,
			"MediaBox must be an array of four finite numbers",
		)
	}

	if (entries.Resources === undefined) {
		if (!inheritedResources) {
			add(
				context,
				"missing-page-attribute",
				`${path}.Resources`,
				"A Page must have direct or inherited Resources",
			)
		}
	} else {
		validateResourceDictionary(
			entries.Resources,
			`${path}.Resources`,
			objects,
			context,
		)
	}

	const contents = entries.Contents
	if (contents !== undefined) {
		if (isReference(contents)) {
			validateStreamReference(contents, `${path}.Contents`, objects, context)
		} else if (isPdfArray(contents)) {
			for (let index = 0; index < contents.items.length; index += 1) {
				const item = contents.items[index]
				if (!isReference(item)) {
					add(
						context,
						"invalid-page-tree",
						`${path}.Contents[${index}]`,
						"Page Contents arrays must contain indirect references",
					)
				} else {
					validateStreamReference(
						item,
						`${path}.Contents[${index}]`,
						objects,
						context,
					)
				}
			}
		} else {
			add(
				context,
				"invalid-page-tree",
				`${path}.Contents`,
				"Page Contents must be a stream reference or an array of stream references",
			)
		}
	}

	validateRotation(entries.Rotate, `${path}.Rotate`, context)
}

function validateRotation(
	value: PdfValue | undefined,
	path: string,
	context: ValidationContext,
): void {
	if (
		value !== undefined &&
		(typeof value !== "number" ||
			!Number.isSafeInteger(value) ||
			value % 90 !== 0)
	) {
		add(
			context,
			"invalid-page-tree",
			path,
			"Page Rotate must be an integer multiple of 90",
		)
	}
}

function validateInheritedRectangle(
	value: PdfValue | undefined,
	path: string,
	context: ValidationContext,
	inherited: boolean,
): boolean {
	if (value === undefined) {
		return inherited
	}

	if (!isRectangle(value)) {
		add(
			context,
			"invalid-page-tree",
			path,
			"An inherited MediaBox must be an array of four finite numbers",
		)
		return false
	}

	return true
}

function validateInheritedResources(
	value: PdfValue | undefined,
	path: string,
	objects: ReadonlyMap<number, PdfIndirectObject>,
	context: ValidationContext,
	inherited: boolean,
): boolean {
	if (value === undefined) {
		return inherited
	}

	return validateResourceDictionary(value, path, objects, context)
}

function validateResourceDictionary(
	value: PdfValue,
	path: string,
	objects: ReadonlyMap<number, PdfIndirectObject>,
	context: ValidationContext,
): boolean {
	if (isDictionary(value)) {
		return true
	}

	if (isReference(value)) {
		const target = resolveMatching(value, objects)
		if (target === undefined) {
			return false
		}

		if (isDictionary(target.value)) {
			return true
		}

		add(
			context,
			"incorrect-reference-target",
			path,
			"Resources must reference a dictionary",
		)
		return false
	}

	add(
		context,
		"invalid-page-tree",
		path,
		"Resources must be a dictionary or an indirect dictionary reference",
	)
	return false
}

function validateStreamReference(
	reference: PdfReference,
	path: string,
	objects: ReadonlyMap<number, PdfIndirectObject>,
	context: ValidationContext,
): void {
	const target = resolveMatching(reference, objects)
	if (target !== undefined && !isStream(target.value)) {
		add(
			context,
			"incorrect-reference-target",
			path,
			"Page Contents must reference a stream",
		)
	}
}

function isRectangle(value: PdfValue): boolean {
	return (
		isPdfArray(value) &&
		value.items.length === 4 &&
		value.items.every(
			(item) => typeof item === "number" && Number.isFinite(item),
		)
	)
}

function markUnreachableObjects(
	document: PdfDocument,
	objects: ReadonlyMap<number, PdfIndirectObject>,
	context: ValidationContext,
): void {
	const reachable = new Set<number>()
	const pending: PdfReference[] = isReference(document.root)
		? [document.root]
		: []
	if (isReference(document.info)) {
		pending.push(document.info)
	}

	while (pending.length > 0) {
		const reference = pending.pop()
		if (reference === undefined || reachable.has(reference.objectNumber)) {
			continue
		}

		const object = resolve(reference, objects)
		if (object === undefined) {
			continue
		}

		reachable.add(reference.objectNumber)
		collectReferences(object.value, pending, new Set())
	}

	for (const object of objects.values()) {
		if (!reachable.has(object.objectNumber)) {
			add(
				context,
				"unreachable-object",
				`object ${object.objectNumber}`,
				`Object ${object.objectNumber} is not reachable from Root or Info`,
				undefined,
				"warning",
			)
		}
	}
}

function collectReferences(
	value: PdfValue | PdfStream,
	result: PdfReference[],
	visited: Set<object>,
): void {
	if (value === null || typeof value !== "object") {
		return
	}

	if (value.kind === "reference") {
		result.push(value)
		return
	}

	if (visited.has(value)) {
		return
	}

	visited.add(value)
	if (value.kind === "array" && Array.isArray(value.items)) {
		for (const item of value.items) {
			collectReferences(item, result, visited)
		}
	} else if (
		(value.kind === "dictionary" || value.kind === "stream") &&
		isRecord(value.entries)
	) {
		for (const item of Object.values(value.entries)) {
			if (item !== undefined) {
				collectReferences(item, result, visited)
			}
		}
		if (Array.isArray(value.byteEntries)) {
			for (const entry of value.byteEntries) {
				if (Array.isArray(entry) && entry.length === 2) {
					collectReferences(entry[1], result, visited)
				}
			}
		}
	}
}

function resolve(
	reference: PdfReference,
	objects: ReadonlyMap<number, PdfIndirectObject>,
): PdfIndirectObject | undefined {
	return objects.get(reference.objectNumber)
}

function resolveMatching(
	reference: PdfReference,
	objects: ReadonlyMap<number, PdfIndirectObject>,
): PdfIndirectObject | undefined {
	const object = resolve(reference, objects)
	return object?.generation === reference.generation ? object : undefined
}

function isObjectNumber(value: unknown): value is number {
	return (
		Number.isSafeInteger(value) &&
		Number(value) > 0 &&
		Number(value) <= 9_999_999_999
	)
}

function isGenerationNumber(value: unknown): value is number {
	return (
		Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 65_534
	)
}

function isRecord(value: unknown): value is PdfDictionaryEntries {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isReference(value: unknown): value is PdfReference {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { readonly kind?: unknown }).kind === "reference"
	)
}

function isDictionary(value: unknown): value is PdfDictionary {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { readonly kind?: unknown }).kind === "dictionary" &&
		isRecord((value as { readonly entries?: unknown }).entries) &&
		((value as { readonly byteEntries?: unknown }).byteEntries === undefined ||
			Array.isArray((value as { readonly byteEntries?: unknown }).byteEntries))
	)
}

function isStream(value: unknown): value is PdfStream {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { readonly kind?: unknown }).kind === "stream" &&
		isRecord((value as { readonly entries?: unknown }).entries) &&
		((value as { readonly byteEntries?: unknown }).byteEntries === undefined ||
			Array.isArray(
				(value as { readonly byteEntries?: unknown }).byteEntries,
			)) &&
		(value as { readonly data?: unknown }).data instanceof Uint8Array
	)
}

function isPdfArray(value: unknown): value is PdfArray {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { readonly kind?: unknown }).kind === "array" &&
		Array.isArray((value as { readonly items?: unknown }).items)
	)
}

function sameReference(value: unknown, expected: PdfReference): boolean {
	return (
		isReference(value) &&
		value.objectNumber === expected.objectNumber &&
		value.generation === expected.generation
	)
}

function add(
	context: ValidationContext,
	code: PdfDiagnosticCode,
	path: string,
	message: string,
	related?: PdfDiagnostic["related"],
	severity: PdfDiagnostic["severity"] = "error",
): void {
	context.diagnostics.push({
		severity,
		code,
		path,
		message,
		...(related === undefined ? {} : { related }),
	})
}
