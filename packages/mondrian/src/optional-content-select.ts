// SPDX-License-Identifier: MPL-2.0
import {
	createOptionalContentTransformer,
	initialPaint,
} from "./optional-content-stream.ts"
import type { OptionalContentMembership as Group } from "./optional-content-stream.ts"

import { unzlibSync } from "fflate"
import { dictionaryValue as entry } from "./dictionary-lookup.ts"
import type {
	PdfDictionary,
	PdfDocument,
	PdfIndirectValue,
	PdfReference,
	PdfStream,
	PdfValue,
} from "./objects.ts"
import {
	dictionary,
	indirectObject,
	objectNumber,
	reference,
	stream,
} from "./objects.ts"
import type {
	PdfInkOutputPolicy,
	PdfOptionalContentSelection,
	PdfProcessingStep,
} from "./optional-content.ts"
import {
	assertProcessingStep,
	optionalContentReference,
} from "./optional-content.ts"
import { pdfName } from "./pdf-names.ts"
import { replaceEntries } from "./dictionary-replace.ts"
import { throwForPdfErrors } from "./diagnostics.ts"
import { validatePdf } from "./validate.ts"

/** Resolve the supported OCG subset into a derived proof document. Original layers remain intact. */
export function selectPdfOptionalContent(
	document: PdfDocument,
	selection: PdfOptionalContentSelection,
): PdfDocument {
	if (!["ON", "OFF"].includes(selection?.baseState))
		throw new TypeError("Proof selection baseState must be ON or OFF")
	return resolveOptionalContent(document, selection)
}

/** Ink selection deliberately ignores the document's default/view/print visibility. */
export function selectPdfInkContent(
	document: PdfDocument,
	policy?: PdfInkOutputPolicy,
): PdfDocument {
	if (policy !== undefined) {
		if (
			policy?.processingSteps?.default !== "error" ||
			!Array.isArray(policy.processingSteps.rules)
		)
			throw new TypeError(
				"inkOutput requires processingSteps.default: error and explicit rules",
			)
		const seen = new Set<string>()
		for (const rule of policy.processingSteps.rules) {
			assertProcessingStep({ group: rule.group, type: rule.type })
			if (!["include", "exclude"].includes(rule.action))
				throw new TypeError("Ink output action must be include or exclude")
			const key = `${rule.group}/${rule.type}`
			if (seen.has(key))
				throw new TypeError(`Duplicate ink output rule for ${key}`)
			seen.add(key)
		}
	}
	return resolveOptionalContent(document, undefined, policy)
}

function resolveOptionalContent(
	document: PdfDocument,
	selection?: PdfOptionalContentSelection,
	policy?: PdfInkOutputPolicy,
): PdfDocument {
	throwForPdfErrors(validatePdf(document))
	const byNumber = new Map(
		document.objects.map((object) => [object.objectNumber as number, object]),
	)
	const resolve = (
		value: PdfValue | undefined,
	): PdfIndirectValue | undefined => {
		const seen = new Set<number>()
		while (value && typeof value === "object" && value.kind === "reference") {
			if (seen.has(value.objectNumber))
				throw new TypeError("Cyclic optional-content reference")
			seen.add(value.objectNumber)
			const object = byNumber.get(value.objectNumber)
			if (!object || object.generation !== value.generation)
				throw new TypeError("Unresolved optional-content reference")
			const resolved = object.value
			if (
				resolved &&
				typeof resolved === "object" &&
				resolved.kind === "stream"
			)
				return resolved
			value = resolved
		}
		return value
	}
	const dict = (value: PdfValue | undefined): PdfDictionary => {
		const resolved = resolve(value)
		if (
			!resolved ||
			typeof resolved !== "object" ||
			resolved.kind !== "dictionary"
		)
			throw new TypeError("Expected an optional-content dictionary")
		return resolved
	}
	const items = (value: PdfValue | undefined): readonly PdfValue[] => {
		const resolved = resolve(value)
		if (!resolved || typeof resolved !== "object" || resolved.kind !== "array")
			throw new TypeError("Expected an optional-content array")
		return resolved.items
	}
	const catalog = dict(document.root)
	const propertiesValue = entry(catalog, "OCProperties")
	// No optional content: preserve existing plate behavior and avoid touching arbitrary streams.
	if (propertiesValue === undefined) {
		if (
			selection &&
			(selection.on?.length ?? 0) + (selection.off?.length ?? 0) > 0
		)
			throw new TypeError("Document has no registered optional content groups")
		return document
	}
	const properties = dict(propertiesValue)
	if (entry(properties, "Configs") !== undefined)
		throw new TypeError(
			"Alternate optional-content configurations are unsupported; supply a simple OCG configuration",
		)
	const configuration =
		entry(properties, "D") === undefined
			? undefined
			: dict(entry(properties, "D"))
	if (
		configuration &&
		["AS", "RBGroups", "Locked"].some(
			(key) => entry(configuration, key) !== undefined,
		)
	)
		throw new TypeError(
			"Optional-content usage applications, radio groups, and locked groups are unsupported",
		)
	const overrides = new Map<number, boolean>()
	for (const [list, visible] of [
		[selection?.on ?? [], true],
		[selection?.off ?? [], false],
	] as const) {
		for (const handle of list) {
			const ref = optionalContentReference(document, handle)
			if (overrides.has(ref.objectNumber))
				throw new TypeError("Duplicate or contradictory proof layer selection")
			const object = byNumber.get(ref.objectNumber)
			if (!object || object.generation !== ref.generation)
				throw new TypeError("Proof selection references an unknown OCG")
			overrides.set(ref.objectNumber, visible)
		}
	}
	const groups = new Map<number, Group>()
	for (const value of items(entry(properties, "OCGs"))) {
		if (!value || typeof value !== "object" || value.kind !== "reference")
			throw new TypeError("OCGs must contain indirect OCG references")
		if (groups.has(value.objectNumber))
			throw new TypeError("Duplicate OCG registration")
		const group = dict(value)
		if (pdfName(resolve(entry(group, "Type"))) !== "/OCG")
			throw new TypeError(
				"Optional-content membership dictionaries (OCMD) are unsupported",
			)
		if (entry(group, "Usage") !== undefined)
			throw new TypeError(
				"Viewer-specific optional-content Usage dictionaries are unsupported",
			)
		let step: PdfProcessingStep | undefined
		if (entry(group, "GTS_Metadata") !== undefined) {
			const metadata = dict(entry(group, "GTS_Metadata"))
			const groupName = pdfName(resolve(entry(metadata, "GTS_ProcStepsGroup")))
			const type = pdfName(resolve(entry(metadata, "GTS_ProcStepsType")))
			if (
				entry(metadata, "GTS_ProcStepsGroup") !== undefined ||
				entry(metadata, "GTS_ProcStepsType") !== undefined
			) {
				step = {
					group: groupName?.slice(1),
					type: type?.slice(1),
				} as PdfProcessingStep
				assertProcessingStep(step)
			}
		}
		let visible: boolean
		if (selection)
			visible =
				overrides.get(value.objectNumber) ?? selection.baseState === "ON"
		else {
			if (!policy)
				throw new TypeError(
					"Optional-content plate previews require an explicit inkOutput processing-step policy",
				)
			if (!step)
				throw new TypeError(
					"Ink output cannot interpret an unclassified OCG; resolve its proof membership explicitly first",
				)
			const rule = policy.processingSteps.rules.find(
				(rule) => rule.group === step.group && rule.type === step.type,
			)
			if (!rule)
				throw new TypeError(
					`Missing ink output rule for ${step.group}/${step.type}`,
				)
			visible = rule.action === "include"
		}
		groups.set(value.objectNumber, { ref: value, step, visible })
	}
	for (const number of overrides.keys())
		if (!groups.has(number))
			throw new TypeError("Proof selection references an unregistered OCG")
	const membership = (value: PdfValue | undefined): Group => {
		if (!value || typeof value !== "object" || value.kind !== "reference")
			throw new TypeError(
				"Optional-content membership must reference a registered OCG; inline dictionaries and OCMD expressions are unsupported",
			)
		const group = groups.get(value.objectNumber)
		if (!group || group.ref.generation !== value.generation)
			throw new TypeError(
				"Optional-content membership references an unregistered OCG",
			)
		return group
	}
	let next =
		document.objects.reduce(
			(highest, object) => Math.max(highest, object.objectNumber),
			0,
		) + 1
	const additions: ReturnType<typeof indirectObject>[] = []
	const replacements = new Map<number, PdfIndirectValue>()
	const add = (value: PdfIndirectValue): PdfReference => {
		const number = objectNumber(next++)
		additions.push(indirectObject(number, value))
		return reference(number)
	}
	const read = (value: PdfStream): string => {
		let data = value.data
		const filter = resolve(entry(value, "Filter"))
		if (filter !== undefined) {
			const filterName =
				filter && typeof filter === "object" && filter.kind === "array"
					? filter.items.length === 1
						? pdfName(resolve(filter.items[0]))
						: undefined
					: pdfName(filter)
			if (
				filterName !== "/FlateDecode" ||
				entry(value, "DecodeParms") !== undefined
			)
				throw new TypeError(
					"Optional-content selection supports unfiltered or FlateDecode content without DecodeParms",
				)

			data = unzlibSync(data)
		}
		return Array.from(data, (byte) => String.fromCharCode(byte)).join("")
	}
	const contentBytes = (value: PdfValue | undefined): string => {
		if (value === undefined) return ""
		const resolved = resolve(value)
		if (resolved && typeof resolved === "object" && resolved.kind === "array")
			return resolved.items.map(contentBytes).join("\n")
		if (!resolved || typeof resolved !== "object" || resolved.kind !== "stream")
			throw new TypeError("Expected a page content stream")
		return read(resolved)
	}
	const transform = createOptionalContentTransformer({
		resolve,
		dict,
		items,
		read,
		add,
		membership,
	})

	for (const object of document.objects) {
		const value = object.value
		if (
			value &&
			typeof value === "object" &&
			value.kind === "dictionary" &&
			(pdfName(resolve(entry(value, "Type"))) === "/Annot" ||
				entry(value, "Subtype") !== undefined) &&
			entry(value, "OC") !== undefined
		)
			throw new TypeError("Optional-content annotations are unsupported")
	}

	const visited = new Set<number>()
	const walk = (ref: PdfValue, inheritedResources?: PdfDictionary): void => {
		if (
			!ref ||
			typeof ref !== "object" ||
			ref.kind !== "reference" ||
			visited.has(ref.objectNumber)
		)
			throw new TypeError("Invalid or recursive page tree")
		visited.add(ref.objectNumber)
		const node = dict(ref)
		const resources =
			entry(node, "Resources") === undefined
				? inheritedResources
				: dict(entry(node, "Resources"))
		if (pdfName(resolve(entry(node, "Type"))) === "/Pages") {
			for (const child of items(entry(node, "Kids"))) walk(child, resources)
			replacements.set(
				ref.objectNumber,
				replaceEntries(node, { Resources: undefined }),
			)
		} else {
			const sourceResources = resources ?? dictionary({})
			const projected = transform(
				contentBytes(entry(node, "Contents")),
				sourceResources,
				sourceResources,
				initialPaint(),
			)
			replacements.set(
				ref.objectNumber,
				replaceEntries(node, {
					Contents: add(stream({}, projected.data)),
					Resources: projected.resources,
				}),
			)
		}
	}
	walk(entry(catalog, "Pages")!)
	replacements.set(
		document.root.objectNumber,
		replaceEntries(catalog, { OCProperties: undefined }),
	)
	const objects = [
		...document.objects.map((object) => ({
			...object,
			value: replacements.get(object.objectNumber) ?? object.value,
		})),
		...additions,
	]
	const all = new Map(
		objects.map((object) => [object.objectNumber as number, object]),
	)
	const reachable = new Set<number>()
	const visit = (value: PdfIndirectValue | PdfReference | undefined): void => {
		if (!value || typeof value !== "object") return
		if (value.kind === "reference") {
			if (reachable.has(value.objectNumber)) return
			reachable.add(value.objectNumber)
			visit(all.get(value.objectNumber)?.value)
		} else if (value.kind === "array") value.items.forEach(visit)
		else if (value.kind === "dictionary" || value.kind === "stream") {
			Object.values(value.entries).forEach(visit)
			value.byteEntries?.forEach(([, item]) => visit(item))
		}
	}
	visit(document.root)
	visit(document.info)
	const result = {
		...document,
		objects: objects.filter((object) => reachable.has(object.objectNumber)),
	}
	throwForPdfErrors(validatePdf(result))
	return result
}
