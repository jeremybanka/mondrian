import type {
	PdfCatalogDictionary,
	PdfDocument,
	PdfHexString,
	PdfIndirectObject,
	PdfInfoDictionary,
	PdfIndirectValue,
	PdfReference,
	PdfStream,
	PdfValue,
	PdfVersion,
} from "./objects.ts"
import { generationNumber, objectNumber, reference } from "./objects.ts"
import {
	referenceOwner,
	registerDocumentOwner,
	registerReferenceOwner,
} from "./ownership.ts"
import { throwForPdfErrors } from "./diagnostics.ts"
import { validatePdf } from "./validate.ts"

export interface PdfObjectHandle<TValue extends PdfIndirectValue> {
	readonly ref: PdfReference<TValue>
	readonly set: (value: TValue) => void
}

export interface PdfObjectBuilderBuildOptions {
	readonly version?: PdfVersion
	readonly root: PdfReference<PdfCatalogDictionary>
	readonly info?: PdfReference<PdfInfoDictionary>
	readonly id?: readonly [PdfHexString, PdfHexString]
}

export interface PdfObjectBuilder {
	reserve<TValue extends PdfIndirectValue>(): PdfObjectHandle<TValue>
	add<TValue extends PdfIndirectValue>(value: TValue): PdfReference<TValue>
	build(options: PdfObjectBuilderBuildOptions): PdfDocument
}

interface Slot {
	readonly reference: PdfReference
	value?: PdfIndirectValue
	set: boolean
}

export function createPdfObjectBuilder(): PdfObjectBuilder {
	return new ObjectBuilder()
}

class ObjectBuilder implements PdfObjectBuilder {
	readonly #owner = Symbol("PdfObjectBuilder")
	readonly #slots = new Map<number, Slot>()
	#nextObjectNumber = 1

	reserve<TValue extends PdfIndirectValue>(): PdfObjectHandle<TValue> {
		const number = objectNumber(this.#nextObjectNumber)
		this.#nextObjectNumber += 1
		const ref = reference<TValue>(number, generationNumber())
		registerReferenceOwner(ref, this.#owner)
		const slot: Slot = { reference: ref, set: false }
		this.#slots.set(number, slot)

		return Object.freeze({
			ref,
			set: (value: TValue): void => {
				if (slot.set) {
					throw new Error(`PDF object ${number} has already been set`)
				}

				slot.value = value
				slot.set = true
			},
		})
	}

	add<TValue extends PdfIndirectValue>(value: TValue): PdfReference<TValue> {
		const handle = this.reserve<TValue>()
		handle.set(value)
		return handle.ref
	}

	build(options: PdfObjectBuilderBuildOptions): PdfDocument {
		const reachable = this.#findReachable([
			options.root,
			...(options.info === undefined ? [] : [options.info]),
		])
		const objects: PdfIndirectObject[] = []

		for (const number of [...reachable].sort((left, right) => left - right)) {
			const slot = this.#slots.get(number)
			if (slot?.value === undefined) {
				continue
			}

			objects.push(
				Object.freeze({
					objectNumber: objectNumber(number),
					generation: generationNumber(),
					value: slot.value,
				}),
			)
		}

		const document: PdfDocument = Object.freeze({
			version: options.version ?? "1.7",
			root: options.root,
			objects: Object.freeze(objects),
			...(options.info === undefined ? {} : { info: options.info }),
			...(options.id === undefined ? {} : { id: options.id }),
		})
		registerDocumentOwner(document, this.#owner)
		throwForPdfErrors(validatePdf(document))
		return document
	}

	#findReachable(roots: readonly PdfReference[]): ReadonlySet<number> {
		const reachable = new Set<number>()
		const pending = [...roots]

		while (pending.length > 0) {
			const current = pending.pop()
			if (
				current === undefined ||
				referenceOwner(current) !== this.#owner ||
				reachable.has(current.objectNumber)
			) {
				continue
			}

			reachable.add(current.objectNumber)
			const slot = this.#slots.get(current.objectNumber)
			if (slot?.value !== undefined) {
				collectReferences(slot.value, pending, new Set())
			}
		}

		return reachable
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
	if (value.kind === "array") {
		for (const item of value.items) {
			collectReferences(item, result, visited)
		}
	} else if (value.kind === "dictionary" || value.kind === "stream") {
		for (const item of Object.values(value.entries)) {
			if (item !== undefined) {
				collectReferences(item, result, visited)
			}
		}
		for (const entry of value.byteEntries ?? []) {
			collectReferences(entry[1], result, visited)
		}
	}
}
