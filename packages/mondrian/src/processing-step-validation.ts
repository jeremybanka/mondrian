// SPDX-License-Identifier: MPL-2.0

import type { PdfContent } from "./content.ts"
import { getContentRecord } from "./content.ts"
import type { PdfProcessingStep } from "./optional-content.ts"
import { getOptionalContentGroup } from "./optional-content.ts"

/** Deliberately conservative path-only authoring subset; never changes caller paint. */
export function assertStructuralContent(
	contents: readonly PdfContent[],
	step: PdfProcessingStep,
): void {
	for (const content of contents) {
		const record = getContentRecord(content)
		if (record.kind === "optional-content") {
			const nested = getOptionalContentGroup(record.group).processingStep
			if (nested && (nested.group !== step.group || nested.type !== step.type))
				throw new TypeError(
					"A path cannot belong to different processing-step classifications",
				)
			assertStructuralContent(record.content, step)
			continue
		}
		if (record.kind === "form" || record.kind === "transform") {
			assertStructuralContent(record.content, step)
			continue
		}
		if (record.kind !== "graphics")
			throw new TypeError(
				"Structural processing-step content supports vector paths only",
			)
		let fillSpot = false
		let strokeSpot = false
		let fillOverprint = false
		let strokeOverprint = false
		for (const operation of record.operations) {
			if (operation.op === "drawImage")
				throw new TypeError(
					"Structural processing-step content cannot contain images",
				)
			if (operation.op === "fillColor")
				fillSpot = operation.color.space === "Separation"
			if (operation.op === "strokeColor")
				strokeSpot = operation.color.space === "Separation"
			if (operation.op === "paintState") {
				fillOverprint = operation.state.fillOverprint
				strokeOverprint = operation.state.strokeOverprint
			}
			if (
				["fill", "fillAndStroke"].includes(operation.op) &&
				(!fillSpot || !fillOverprint)
			)
				throw new TypeError(
					"Structural paths require an opaque overprinting spot fill",
				)
			if (
				["stroke", "fillAndStroke"].includes(operation.op) &&
				(!strokeSpot || !strokeOverprint)
			)
				throw new TypeError(
					"Structural paths require an opaque overprinting spot stroke",
				)
			if (operation.op === "fill")
				throw new TypeError(
					"Cutting and creasing paths must have a stroke; use stroke() or fillAndStroke()",
				)
		}
	}
}
