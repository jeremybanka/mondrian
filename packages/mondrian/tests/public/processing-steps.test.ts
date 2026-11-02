import { expect, it } from "vite-plus/test"
import {
	cmyk,
	createPdfDocument,
	dictionary,
	name,
	parsePdf,
	rectangle,
	separation,
	selectPdfOptionalContent,
	serializePdf,
} from "mondrian.pdf"
import type {
	PdfDocument,
	PdfInkOutputPolicy,
	PdfOptionalContentGroupOptions,
} from "mondrian.pdf"
import {
	previewPdfPlates,
	renderPdf,
	renderPdfPlateCoverage,
} from "mondrian.pdf/testing"
import "mondrian.pdf/vitest"

const inkOutput: PdfInkOutputPolicy = {
	processingSteps: {
		default: "error",
		rules: [
			{ group: "Structural", type: "Cutting", action: "exclude" },
			{ group: "Structural", type: "Creasing", action: "exclude" },
		],
	},
}
const shared = separation("Shared ink", {
	type: "exponential",
	zero: cmyk(0, 0, 0, 0),
	full: cmyk(0, 1, 0, 0),
	exponent: 1,
})
const technical = separation("Technical only", {
	...shared.tintTransform,
	full: cmyk(0, 0, 0, 1),
})
const overprint = {
	fillOverprint: true,
	strokeOverprint: true,
	overprintMode: 1,
} as const

/** Entirely synthetic: shared spot, technical-only spot, CMYK and two transformed Form uses. */
function fixture(includeTechnical = true, hiddenByDefault = false) {
	const pdf = createPdfDocument()
	const cutting = pdf.optionalContentGroup({
		name: "Not an ink name",
		processingStep: { group: "Structural", type: "Cutting" },
	})
	const creasing = pdf.optionalContentGroup({
		name: "Shared ink",
		processingStep: { group: "Structural", type: "Creasing" },
	})
	const artwork = pdf.graphics((g) => {
		g.cmykFill(0.8, 0.3, 0.1, 0.2).rectangle(5, 5, 85, 60).fill()
		g.spotFill(shared, 0.6).rectangle(25, 15, 40, 35).fill()
	})
	const cut = pdf.graphics((g) => {
		g.paintState(overprint)
			.spotStroke(shared, 1)
			.lineWidth(2)
			.moveTo(10, 10)
			.lineTo(80, 60)
			.stroke()
	})
	const crease = pdf.graphics((g) => {
		g.paintState(overprint)
			.spotStroke(technical, 1)
			.lineWidth(1)
			.moveTo(10, 55)
			.lineTo(80, 15)
			.stroke()
	})
	const layered = includeTechnical
		? [
				pdf.optionalContent(cutting, [cut]),
				pdf.optionalContent(creasing, [crease]),
			]
		: []
	const form = pdf.form({
		bbox: rectangle(0, 0, 100, 70),
		content: [artwork, ...layered],
	})
	const scaled = pdf.transform([0.8, 0, 0, 0.8, 110, 5], [form])
	pdf.setOptionalContentConfiguration({
		baseState: hiddenByDefault ? "OFF" : "ON",
		order: [cutting, creasing],
	})
	pdf.setPages(
		pdf.page({
			mediaBox: rectangle(0, 0, 200, 160),
			content: [artwork, ...layered, form, scaled, form],
		}),
	)
	return { pdf, cutting, creasing, document: pdf.compile() }
}

it("encodes OCG registration, metadata, membership and geometry deterministically through round trips", () => {
	const { pdf, document } = fixture()
	expect(pdf.serialize()).toEqual(serializePdf(document))
	const bytes = serializePdf(document)
	const source = Buffer.from(bytes).toString("latin1")
	expect(source).toContain("/GTS_ProcStepsGroup /Structural")
	expect(source).toContain("/GTS_ProcStepsType /Cutting")
	expect(source).toContain("/GTS_ProcStepsType /Creasing")
	expect(source).toContain("/OC /OC0 BDC")
	const parsed = parsePdf(bytes)
	expect(serializePdf(parsePdf(serializePdf(parsed)))).toEqual(
		serializePdf(parsed),
	)
	expect(
		parsed.objects.filter(
			(o) =>
				o.value &&
				typeof o.value === "object" &&
				o.value.kind === "dictionary" &&
				typeof o.value.entries.Type === "object" &&
				o.value.entries.Type !== null &&
				o.value.entries.Type.kind === "name" &&
				o.value.entries.Type.value === "OCG",
		),
	).toHaveLength(2)
})

it("selects proofs independently of default visibility and preserves the original layered PDF", async () => {
	const { document, cutting, creasing } = fixture(true, true)
	const before = serializePdf(document)
	const shown = selectPdfOptionalContent(document, { baseState: "ON" })
	const hidden = selectPdfOptionalContent(document, {
		baseState: "ON",
		off: [cutting, creasing],
	})
	const baseline = selectPdfOptionalContent(fixture(false).document, {
		baseState: "ON",
	})
	const [showPixels, hidePixels, basePixels] = await Promise.all(
		[shown, hidden, baseline].map(
			async (doc) =>
				(await renderPdf(serializePdf(doc), { resolution: 72 })).pages[0]!
					.pixels,
		),
	)
	expect(hidePixels).toEqual(basePixels)
	expect(showPixels).not.toEqual(hidePixels)
	expect(serializePdf(document)).toEqual(before)
	await expect(serializePdf(shown)).toMatchPdfArtifact(
		"processing-steps-shown",
		{ resolution: 96 },
	)
	await expect(serializePdf(hidden)).toMatchPdfArtifact(
		"processing-steps-hidden",
		{ resolution: 96 },
	)
})

it("excludes technical marks before ink discovery with exact retained coverage and shared printable spots", async () => {
	const baseline = fixture(false).document
	const source = fixture().document
	const parsed = parsePdf(serializePdf(source))
	const baselinePixels = []
	for (const preview of previewPdfPlates(baseline, { inkOutput }))
		baselinePixels.push(
			(await renderPdf(serializePdf(preview.document), { resolution: 72 }))
				.pages[0]!.pixels,
		)
	const expected = await renderPdfPlateCoverage(baseline, {
		inkOutput,
		resolution: 72,
	})
	expect(expected.plates.map((p) => p.name)).toEqual([
		"Cyan",
		"Magenta",
		"Yellow",
		"Black",
		"Shared ink",
	])
	for (const document of [source, parsed, fixture(true, true).document]) {
		const actual = await renderPdfPlateCoverage(document, {
			inkOutput,
			resolution: 72,
		})
		expect(actual.plates.map((p) => p.name)).toEqual(
			expected.plates.map((p) => p.name),
		)
		for (const [index, plate] of actual.plates.entries())
			expect(plate.pages[0]!.samples).toEqual(
				expected.plates[index]!.pages[0]!.samples,
			)
		const previews = previewPdfPlates(document, { inkOutput })
		for (const [index, preview] of previews.entries()) {
			const actualPixels = (
				await renderPdf(serializePdf(preview.document), { resolution: 72 })
			).pages[0]!.pixels
			const expectedPixels = baselinePixels[index]
			expect(actualPixels).toEqual(expectedPixels)
		}
	}
	const included = previewPdfPlates(source, {
		inkOutput: {
			processingSteps: {
				default: "error",
				rules: inkOutput.processingSteps.rules.map((rule) => ({
					...rule,
					action: "include",
				})),
			},
		},
	})
	expect(included.map((p) => p.name)).toContain("Technical only")
}, 30_000)

it("preserves plate behavior without optional content", async () => {
	const pdf = createPdfDocument()
	pdf.setPages(
		pdf.page({
			mediaBox: rectangle(0, 0, 20, 20),
			content: [
				pdf.graphics((g) => {
					g.cmykFill(1, 0, 0, 0).rectangle(0, 0, 20, 20).fill()
				}),
			],
		}),
	)
	const doc = pdf.compile()
	expect(previewPdfPlates(doc, { inkOutput })).toEqual(previewPdfPlates(doc))
	expect(
		await renderPdfPlateCoverage(doc, { inkOutput, resolution: 72 }),
	).toEqual(await renderPdfPlateCoverage(doc, { resolution: 72 }))
})

it("rejects contradictory authoring and foreign handles", () => {
	const pdf = createPdfDocument()
	const cutting = pdf.optionalContentGroup({
		name: "cut",
		processingStep: { group: "Structural", type: "Cutting" },
	})
	expect(() =>
		pdf.optionalContentGroup({
			name: "",
			processingStep: { group: "Structural", type: "Cutting" },
		}),
	).toThrow(/nonempty/)
	expect(() =>
		pdf.optionalContentGroup({
			name: "bad",
			processingStep: { group: "Structural", type: "Typo" },
		} as unknown as PdfOptionalContentGroupOptions),
	).toThrow(/Supported processing steps/)
	expect(() =>
		createPdfDocument({ version: "1.4" }).optionalContentGroup({ name: "cut" }),
	).toThrow(/1.5/)
	expect(() => createPdfDocument().optionalContent(cutting, [])).toThrow(
		/another document/,
	)
	expect(() =>
		pdf.setOptionalContentConfiguration({
			baseState: "ON",
			on: [cutting],
			off: [cutting],
		}),
	).toThrow(/both ON and OFF/)
	const knockout = pdf.graphics((g) => {
		g.spotStroke(shared, 1).moveTo(0, 0).lineTo(10, 10).stroke()
	})
	expect(() => pdf.optionalContent(cutting, [knockout])).toThrow(
		/overprinting spot stroke/,
	)
	const process = pdf.graphics((g) => {
		g.paintState(overprint).cmykFill(1, 0, 0, 0).rectangle(0, 0, 10, 10).fill()
	})
	expect(() => pdf.optionalContent(cutting, [process])).toThrow(
		/overprinting spot fill/,
	)
	const fillOnly = pdf.graphics((g) => {
		g.paintState(overprint).spotFill(shared, 1).rectangle(0, 0, 10, 10).fill()
	})
	expect(() => pdf.optionalContent(cutting, [fillOnly])).toThrow(
		/must have a stroke/,
	)

	const creasing = pdf.optionalContentGroup({
		name: "crease",
		processingStep: { group: "Structural", type: "Creasing" },
	})
	expect(() =>
		pdf.optionalContent(cutting, [pdf.optionalContent(creasing, [])]),
	).toThrow(/different processing-step/)
})

it("requires complete explicit output rules and accepts parsed OCG references for proof selection", () => {
	const { document, cutting } = fixture()
	expect(() => previewPdfPlates(document)).toThrow(/explicit inkOutput/)
	expect(() =>
		previewPdfPlates(document, {
			inkOutput: { processingSteps: { default: "error", rules: [] } },
		}),
	).toThrow(/Missing ink output rule/)
	const parsed = parsePdf(serializePdf(document))
	expect(() =>
		selectPdfOptionalContent(parsed, { baseState: "ON", off: [cutting] }),
	).toThrow(/does not belong/)
	const root = parsed.objects.find(
		(o) => o.objectNumber === parsed.root.objectNumber,
	)!.value
	if (!root || typeof root !== "object" || root.kind !== "dictionary")
		throw new Error("Expected catalog")
	const props = root.entries.OCProperties
	if (!props || typeof props !== "object" || props.kind !== "dictionary")
		throw new Error("Expected OCProperties")
	const ocgs = props.entries.OCGs
	if (!ocgs || typeof ocgs !== "object" || ocgs.kind !== "array")
		throw new Error("Expected OCGs")
	const ref = ocgs.items[0]!
	if (!ref || typeof ref !== "object" || ref.kind !== "reference")
		throw new Error("Expected OCG ref")
	expect(() =>
		selectPdfOptionalContent(parsed, { baseState: "ON", off: [ref] }),
	).not.toThrow()
})

function mutateGroup(
	document: PdfDocument,
	entries: Record<string, import("mondrian.pdf").PdfValue>,
): PdfDocument {
	return {
		...document,
		objects: document.objects.map((object) => {
			const value = object.value
			if (
				value &&
				typeof value === "object" &&
				value.kind === "dictionary" &&
				typeof value.entries.Type === "object" &&
				value.entries.Type !== null &&
				value.entries.Type.kind === "name" &&
				value.entries.Type.value === "OCG"
			)
				return {
					...object,
					value: dictionary({ ...value.entries, ...entries }),
				}
			return object
		}),
	}
}

it("rejects unsupported metadata and viewer-specific optional-content constructs even when excluded", () => {
	const { document } = fixture()
	const unknown = mutateGroup(document, {
		GTS_Metadata: dictionary({ GTS_ProcStepsGroup: name("White") }),
	})
	expect(() => previewPdfPlates(unknown, { inkOutput })).toThrow(
		/Supported processing steps/,
	)
	const usage = mutateGroup(document, {
		Usage: dictionary({ Print: dictionary({ PrintState: name("OFF") }) }),
	})
	expect(() => previewPdfPlates(usage, { inkOutput })).toThrow(/Usage/)
})

function rewriteContent(
	document: PdfDocument,
	edit: (source: string) => string,
): PdfDocument {
	return {
		...document,
		objects: document.objects.map((object) => {
			const value = object.value
			if (!value || typeof value !== "object" || value.kind !== "stream")
				return object
			const source = Buffer.from(value.data).toString("latin1")
			return source.includes("/OC ")
				? {
						...object,
						value: {
							...value,
							data: new Uint8Array(Buffer.from(edit(source), "latin1")),
						},
					}
				: object
		}),
	}
}

it("rejects optional scopes that leak state, split paths, or use unsupported expressions", () => {
	const { document } = fixture()
	for (const [edit, diagnostic] of [
		[
			(s: string) => s.replace(/BDC\nq\n/u, "BDC\n"),
			/isolate graphics state|Unbalanced|balanced/,
		],
		[(s: string) => s + "\nEMC", /Unbalanced/],
		[
			(s: string) => s.replace(/\/OC \/OC0 BDC/u, "/OC << /Type /OCMD >> BDC"),
			/requires \/OC \/resource/,
		],
		[
			(s: string) => s.replace(/\/OC \/OC0 BDC/u, "/OC /Unknown BDC"),
			/registered OCG/,
		],
		[
			(s: string) => s.replace(/\/OC \/OC0 BDC/u, "0 0 m /OC /OC0 BDC"),
			/split a path/,
		],
		[
			(s: string) => s.replace(/BDC\nq\n/u, "BDC\nq\n0 0 1 1 re W n\n"),
			/Unsupported structural/,
		],
	] as const) {
		expect(() =>
			previewPdfPlates(rewriteContent(document, edit), { inkOutput }),
		).toThrow(diagnostic)
	}
	expect(() =>
		previewPdfPlates(mutateGroup(document, { Type: name("OCMD") }), {
			inkOutput,
		}),
	).toThrow(/OCMD/)
})

it("validates parsed technical paint even when excluded, including inherited masking and clipping", () => {
	const { document } = fixture()
	for (const entries of [
		{ OP: false, op: false },
		{ CA: 0.5 },
		{ BM: name("Multiply") },
		{ SMask: dictionary({ S: name("Alpha") }) },
	]) {
		const invalid = {
			...document,
			objects: document.objects.map((object) => {
				const value = object.value
				if (
					value &&
					typeof value === "object" &&
					value.kind === "dictionary" &&
					"OP" in value.entries
				)
					return {
						...object,
						value: dictionary({ ...value.entries, ...entries }),
					}
				return object
			}),
		}
		expect(() => previewPdfPlates(invalid, { inkOutput })).toThrow(
			/opaque overprinting spot/,
		)
	}
	const clipped = rewriteContent(document, (source) =>
		source.replace(/\/OC \/OC0 BDC/u, "0 0 1 1 re W n /OC /OC0 BDC"),
	)
	expect(() => previewPdfPlates(clipped, { inkOutput })).toThrow(/clipping/)
})

it("rejects structural text and Form clipping without changing the description", () => {
	const pdf = createPdfDocument()
	const group = pdf.optionalContentGroup({
		name: "cut",
		processingStep: { group: "Structural", type: "Cutting" },
	})
	const font = pdf.standardFont("Helvetica")
	expect(() =>
		pdf.optionalContent(group, [
			pdf.text((t) => t.font(font, 10).show("Not a path")),
		]),
	).toThrow(/vector paths only/)
	const line = pdf.graphics((g) => {
		g.paintState(overprint)
			.spotStroke(shared, 1)
			.moveTo(0, 0)
			.lineTo(50, 50)
			.stroke()
	})
	const form = pdf.form({
		bbox: rectangle(0, 0, 10, 10),
		content: [pdf.optionalContent(group, [line])],
	})
	pdf.setPages(
		pdf.page({ mediaBox: rectangle(0, 0, 100, 100), content: [form] }),
	)
	expect(() => pdf.compile()).toThrow(/Form BBox/)
})

it("keeps reused Form invocations distinct when only one invocation is a processing step", async () => {
	const pdf = createPdfDocument()
	const group = pdf.optionalContentGroup({
		name: "cut",
		processingStep: { group: "Structural", type: "Cutting" },
	})
	const vector = pdf.graphics((g) => {
		g.paintState(overprint)
			.spotStroke(shared, 1)
			.lineWidth(2)
			.moveTo(5, 5)
			.lineTo(35, 35)
			.stroke()
	})
	const form = pdf.form({ bbox: rectangle(0, 0, 40, 40), content: [vector] })
	const printable = pdf.transform([1, 0, 0, 1, 50, 0], [form])
	pdf.setPages(
		pdf.page({
			mediaBox: rectangle(0, 0, 100, 50),
			content: [pdf.optionalContent(group, [form]), printable],
		}),
	)
	const document = pdf.compile()
	const plate = (
		await renderPdfPlateCoverage(document, { inkOutput, resolution: 72 })
	).plates.find((p) => p.name === "Shared ink")!
	const samples = plate.pages[0]!.samples
	expect(samples[30 * 100 + 20]).toBe(255)
	expect(samples[30 * 100 + 70]).toBeLessThan(255)
})

it("resolves compressed page and Form content after parsing", async () => {
	const { zlibSync } = await import("fflate")
	const { document } = fixture()
	const compressed = {
		...document,
		objects: document.objects.map((object) => {
			const value = object.value
			if (!value || typeof value !== "object" || value.kind !== "stream")
				return object
			return {
				...object,
				value: {
					...value,
					entries: { ...value.entries, Filter: name("FlateDecode") },
					data: zlibSync(value.data),
				},
			}
		}),
	}
	const selection = { baseState: "ON" } as const
	expect(
		serializePdf(
			selectPdfOptionalContent(parsePdf(serializePdf(compressed)), selection),
		),
	).toEqual(serializePdf(selectPdfOptionalContent(document, selection)))
})

it("supports ordinary optional text while requiring an explicit resolution before ink output", () => {
	const pdf = createPdfDocument()
	const group = pdf.optionalContentGroup({ name: "Notes" })
	const font = pdf.standardFont("Helvetica")
	const text = pdf.text((t) =>
		t.font(font, 10).cmykFill(0, 0, 0, 1).moveText(5, 5).show("Notes"),
	)
	pdf.setPages(
		pdf.page({
			mediaBox: rectangle(0, 0, 50, 30),
			content: [pdf.optionalContent(group, [text])],
		}),
	)
	const document = pdf.compile()
	expect(() =>
		selectPdfOptionalContent(document, { baseState: "OFF", on: [group] }),
	).not.toThrow()
	expect(() => previewPdfPlates(document, { inkOutput })).toThrow(
		/unclassified OCG/,
	)
	expect(() =>
		previewPdfPlates(selectPdfOptionalContent(document, { baseState: "OFF" })),
	).not.toThrow()
	expect(() =>
		selectPdfOptionalContent(document, {
			baseState: "ON",
			on: [group],
			off: [group],
		}),
	).toThrow(/contradictory/)
})
