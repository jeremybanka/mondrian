// SPDX-License-Identifier: MPL-2.0

import type { PdfDocument, PdfReference } from "./objects.ts"

/** Supported subset of ISO 19593-1:2026 processing-step classifications. */
export interface PdfProcessingStep {
	readonly group: "Structural"
	readonly type: "Cutting" | "Creasing"
}

declare const groupBrand: unique symbol
/** A document-owned PDF optional content group (OCG), independent of output selection. */
export interface PdfOptionalContentGroup {
	readonly [groupBrand]: "PdfOptionalContentGroup"
}

export interface PdfOptionalContentGroupOptions {
	readonly name: string
	readonly processingStep?: PdfProcessingStep
}

export interface PdfOptionalContentConfiguration {
	readonly baseState: "ON" | "OFF"
	readonly on?: readonly PdfOptionalContentGroup[]
	readonly off?: readonly PdfOptionalContentGroup[]
	readonly order?: readonly PdfOptionalContentGroup[]
}

/** References obtained from parsed documents may replace builder handles. */
export interface PdfOptionalContentSelection {
	readonly baseState: "ON" | "OFF"
	readonly on?: readonly (PdfOptionalContentGroup | PdfReference)[]
	readonly off?: readonly (PdfOptionalContentGroup | PdfReference)[]
}

export interface PdfInkOutputPolicy {
	readonly processingSteps: {
		readonly default: "error"
		readonly rules: readonly (PdfProcessingStep & {
			readonly action: "include" | "exclude"
		})[]
	}
}

interface GroupRecord extends PdfOptionalContentGroupOptions {
	readonly owner: symbol
}
const groups = new WeakMap<PdfOptionalContentGroup, GroupRecord>()
const documentGroups = new WeakMap<
	PdfDocument,
	ReadonlyMap<PdfOptionalContentGroup, PdfReference>
>()

export function assertProcessingStep(value: PdfProcessingStep): void {
	if (
		value?.group !== "Structural" ||
		!["Cutting", "Creasing"].includes(value?.type)
	)
		throw new TypeError(
			"Supported processing steps are Structural/Cutting and Structural/Creasing",
		)
	if (Object.keys(value).some((key) => !["group", "type"].includes(key)))
		throw new TypeError("Unknown processing-step property")
}

export function createOptionalContentGroup(
	owner: symbol,
	options: PdfOptionalContentGroupOptions,
): PdfOptionalContentGroup {
	if (typeof options?.name !== "string" || options.name.trim() === "")
		throw new TypeError("An optional content group requires a nonempty name")
	if (options.processingStep !== undefined)
		assertProcessingStep(options.processingStep)
	const handle = Object.freeze({}) as PdfOptionalContentGroup
	groups.set(
		handle,
		Object.freeze({
			owner,
			name: options.name,
			...(options.processingStep === undefined
				? {}
				: { processingStep: Object.freeze({ ...options.processingStep }) }),
		}),
	)
	return handle
}

export function getOptionalContentGroup(
	group: PdfOptionalContentGroup,
	owner?: symbol,
): GroupRecord {
	const record = groups.get(group)
	if (!record) throw new TypeError("Unknown optional content group handle")
	if (owner !== undefined && record.owner !== owner)
		throw new TypeError(
			"Optional content group belongs to another document builder",
		)
	return record
}

export function registerOptionalContentGroups(
	document: PdfDocument,
	references: ReadonlyMap<PdfOptionalContentGroup, PdfReference>,
): void {
	documentGroups.set(document, references)
}

export function optionalContentReference(
	document: PdfDocument,
	group: PdfOptionalContentGroup | PdfReference,
): PdfReference {
	if ("kind" in group && group.kind === "reference")
		return group as PdfReference
	const ref = documentGroups
		.get(document)
		?.get(group as PdfOptionalContentGroup)
	if (!ref)
		throw new TypeError(
			"Optional content group does not belong to this compiled document; use its OCG reference for a parsed document",
		)
	return ref
}
