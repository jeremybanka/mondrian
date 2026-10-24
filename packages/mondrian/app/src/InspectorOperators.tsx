import { useO } from "@atom.io/react"
import type { PdfIndirectObject } from "mondrian.pdf"
import type { PdfContentOperation } from "mondrian.pdf/inspect"
import {
	createPdfResolver,
	decodePdfInspectionStream,
	inspectPdfContent,
	pdfDictionaryEntries,
	pdfInspectionSyntax,
	pdfObjectId,
} from "mondrian.pdf/inspect"
import { useEffect, useMemo, useRef } from "react"

import { operationExplanations } from "./inspection-knowledge.ts"
import type { InspectionPageProgram } from "./inspection-learning.ts"
import { inspectionHref, operationResource } from "./inspection-learning.ts"
import type { InspectionSession } from "./inspector-state.ts"
import {
	inspectorInstructionSelector,
	navigateInspector,
} from "./inspector-state.ts"
import css from "./InspectorOperators.module.css"

export function InspectorOperators({
	session,
	object,
	pageProgram,
	page,
}: {
	session: InspectionSession
	object: PdfIndirectObject
	pageProgram: InspectionPageProgram | null
	page: number
}) {
	const instruction = useO(inspectorInstructionSelector)
	const root = useRef<HTMLElement>(null)
	const id = pdfObjectId(object.objectNumber, object.generation)
	const result = useMemo<{
		operations: readonly PdfContentOperation[]
		error: string
	}>(() => {
		try {
			const stream = object.value
			if (
				typeof stream !== "object" ||
				stream === null ||
				stream.kind !== "stream"
			)
				return { operations: [], error: "This object has no drawing stream." }
			return {
				operations: inspectPdfContent(
					decodePdfInspectionStream(session.document, stream),
				),
				error: "",
			}
		} catch (error: unknown) {
			return {
				operations: [],
				error: `Instructions unavailable: ${error instanceof Error ? error.message : String(error)}. The encoded and decoded views remain available.`,
			}
		}
	}, [object, session])
	const resources = useMemo(() => {
		const summary = session.index.objects.find((entry) => entry.id === id)
		const inherited =
			summary?.role === "Content stream" && summary.pages.includes(page)
				? pageProgram?.resources
				: undefined
		const entries = new Map(inherited)
		const stream = object.value
		if (
			typeof stream !== "object" ||
			stream === null ||
			stream.kind !== "stream"
		)
			return entries
		const resolve = createPdfResolver(session.document)
		const own = resolve(
			pdfDictionaryEntries(stream).find(([key]) => key === "Resources")?.[1],
		)
		if (typeof own === "object" && own !== null && own.kind === "dictionary") {
			// A Form's explicit Resources replaces the caller's resource dictionary.
			entries.clear()
			for (const [category, dictionary] of pdfDictionaryEntries(own)) {
				const value = resolve(dictionary)
				if (
					typeof value !== "object" ||
					value === null ||
					value.kind !== "dictionary"
				)
					continue
				for (const [name, target] of pdfDictionaryEntries(value))
					if (
						typeof target === "object" &&
						target !== null &&
						target.kind === "reference"
					)
						entries.set(
							`${category}/${name}`,
							pdfObjectId(target.objectNumber, target.generation),
						)
			}
		}
		return entries
	}, [id, object, page, pageProgram, session])
	const selectedIndex = result.operations.findIndex(
		(operation) => operation.offset === instruction?.offset,
	)
	const start = Math.max(0, selectedIndex - 20)
	const shown = result.operations.slice(start, start + 200)
	const selected = result.operations[selectedIndex]
	const resource = selected ? operationResource(selected, resources) : undefined
	useEffect(() => {
		if (!instruction || !root.current) return
		const target = root.current.querySelector<HTMLButtonElement>(
			`button[data-offset="${instruction.offset}"]`,
		)
		target?.scrollIntoView({ block: "center", inline: "nearest" })
		target?.focus({ preventScroll: true })
	}, [instruction, result])
	return (
		<inspector-operators className={css.class} ref={root}>
			<p>
				Select an instruction to explore its meaning. Resource links resolve
				names in the current page or Form context.
			</p>
			{result.error && <p role="status">{result.error}</p>}
			{instruction && !selected && !result.error && (
				<p role="status">
					No instruction starts at decoded byte {instruction.offset} in this
					stream.
				</p>
			)}
			{selected && (
				<section aria-label="Selected instruction" aria-live="polite">
					<strong>
						{selected.operator} · decoded byte {selected.offset}
					</strong>
					<p>
						{operationExplanations[selected.operator] ??
							"This operator acts on the current graphics state. Read the drawing lesson for the surrounding program’s meaning."}
					</p>
					{resource && (
						<a href={inspectionHref(resource)}>
							Inspect resource {resource.replace(":", " ")} R →
						</a>
					)}
					{selected.operator === "Do" && !resource && (
						<p>
							This name could not be resolved in the current resource context.
							Choose a page that uses this stream. A Form without its own
							resources requires its caller’s context.
						</p>
					)}
				</section>
			)}
			{result.operations.length > 0 && (
				<p>
					Showing instructions {start + 1}–{start + shown.length} of{" "}
					{result.operations.length}. Offsets refer to decoded bytes.
				</p>
			)}
			<ol aria-label="Drawing instructions">
				{shown.map((operation) => {
					const target = operationResource(operation, resources)
					return (
						<li key={operation.offset}>
							<button
								type="button"
								data-offset={operation.offset}
								aria-pressed={operation.offset === instruction?.offset}
								onClick={() => navigateInspector(id, operation.offset, page)}
							>
								<code>
									{String(operation.offset).padStart(6)}{" "}
									{operation.operands
										.map((operand) => pdfInspectionSyntax(operand))
										.join(" ")}{" "}
									{operation.operator}
								</code>
							</button>
							{target && (
								<a href={inspectionHref(target)}>
									Resource {target.replace(":", " ")} R →
								</a>
							)}
						</li>
					)
				})}
			</ol>
			{start > 0 && (
				<a
					href={inspectionHref(
						id,
						result.operations[Math.max(0, start - 180)]!.offset,
						page,
					)}
				>
					Previous instructions ←
				</a>
			)}
			{start + shown.length < result.operations.length && (
				<a
					href={inspectionHref(
						id,
						result.operations[start + shown.length]!.offset,
						page,
					)}
				>
					More instructions →
				</a>
			)}
		</inspector-operators>
	)
}
