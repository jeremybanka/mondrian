import { readFileSync } from "node:fs"
import { expect, it } from "vite-plus/test"
import {
	array,
	ascii,
	cmyk,
	createPdfDocument,
	createPdfObjectBuilder,
	dictionary,
	name,
	nameBytes,
	parsePdf,
	rectangle,
	reference,
	separation,
	selectPdfOptionalContent,
	serializePdf,
	stream,
	textString,
} from "mondrian.pdf"
import type {
	PdfDictionary,
	PdfDocument,
	PdfInkOutputPolicy,
	PdfObjectBuilder,
	PdfOptionalContentGroup,
	PdfPagesDictionary,
	PdfReference,
	PdfStream,
	PdfValue,
} from "mondrian.pdf"
import {
	previewPdfPlates,
	renderPdf,
	renderPdfPlateCoverage,
} from "mondrian.pdf/testing"

const inkOutput: PdfInkOutputPolicy = {
	processingSteps: {
		default: "error",
		rules: [
			{ group: "Structural", type: "Cutting", action: "exclude" },
			{ group: "Structural", type: "Creasing", action: "exclude" },
		],
	},
}
const technicalPath = "/Over gs /CutInk CS 1 SCN 1 1 m 9 9 l S"
const optionalPath = `/OC /Cut BDC q ${technicalPath} Q EMC`
const paper = "q 0.7 0.2 0.1 0.1 k 0 0 20 20 re f Q"
const show = { baseState: "ON" } as const

interface FixtureContext {
	readonly objects: PdfObjectBuilder
	readonly cut: PdfReference
	readonly crease: PdfReference
	readonly spare: PdfReference
	readonly resources: PdfDictionary
}
interface FixtureOptions {
	readonly source?: string | readonly string[]
	readonly resources?: (context: FixtureContext) => PdfDictionary
	readonly catalog?: (context: FixtureContext) => Record<string, PdfValue>
	readonly properties?: (context: FixtureContext) => PdfValue
	readonly page?: (
		context: FixtureContext,
	) => Record<string, PdfValue | undefined>
}

/** Minimal PDF graph for import boundaries the semantic builder deliberately cannot author. */
function fixture(options: FixtureOptions = {}) {
	const objects = createPdfObjectBuilder()
	const pages = objects.reserve<PdfPagesDictionary>()
	const group = (type: "Cutting" | "Creasing") =>
		objects.add(
			dictionary({
				Type: name("OCG"),
				Name: textString("Same display label"),
				GTS_Metadata: dictionary({
					GTS_ProcStepsGroup: name("Structural"),
					GTS_ProcStepsType: name(type),
				}),
			}),
		)
	const cut = group("Cutting"),
		crease = group("Creasing"),
		spare = objects.add(
			dictionary({
				Type: name("OCG"),
				Name: textString("Ordinary optional content"),
			}),
		)
	const ink = array(
		name("Separation"),
		name("CutContour"),
		name("DeviceCMYK"),
		dictionary({
			FunctionType: 2,
			Domain: array(0, 1),
			C0: array(0, 0, 0, 0),
			C1: array(0, 1, 0, 0),
			N: 1,
		}),
	)
	const resources = dictionary({
		Properties: dictionary({
			Cut: cut,
			Crease: crease,
			Spare: spare,
			Mark: dictionary({ MCID: 0 }),
		}),
		ColorSpace: dictionary({ CutInk: ink }),
		ExtGState: dictionary({
			Over: dictionary({ Type: name("ExtGState"), OP: true, op: true, OPM: 1 }),
		}),
	})
	const context: FixtureContext = { objects, cut, crease, spare, resources }
	const source = options.source ?? `${paper}\n${optionalPath}`
	const contents =
		typeof source === "string"
			? objects.add(stream({}, ascii(source)))
			: array(...source.map((part) => objects.add(stream({}, ascii(part)))))
	const page = objects.add(
		dictionary({
			Type: name("Page"),
			Parent: pages.ref,
			MediaBox: array(0, 0, 20, 20),
			Contents: contents,
			Resources: options.resources?.(context) ?? resources,
			...options.page?.(context),
		}),
	)
	pages.set(dictionary({ Type: name("Pages"), Kids: array(page), Count: 1 }))
	const root = objects.add(
		dictionary({
			Type: name("Catalog"),
			Pages: pages.ref,
			OCProperties:
				options.properties?.(context) ??
				dictionary({
					OCGs: array(cut, crease),
					D: dictionary({ BaseState: name("ON") }),
				}),
			...options.catalog?.(context),
		}),
	)
	return { document: objects.build({ root }), ...context }
}

function contents(document: PdfDocument): string {
	return document.objects
		.flatMap(({ value }) =>
			value && typeof value === "object" && value.kind === "stream"
				? [Buffer.from(value.data).toString("latin1")]
				: [],
		)
		.join("\n")
}

it("preserves ordinary marked content and byte resource names across split page streams", async () => {
	const tag = nameBytes(Uint8Array.of(0xff))
	const { document } = fixture({
		source: [
			"/Artifact BMC /Span /M#ff BDC",
			paper,
			"EMC EMC /Point /M#ff DP /OC /C#ff BDC q",
			technicalPath,
			"Q EMC",
		],
		resources: ({ resources, cut }) =>
			dictionary({
				...resources.entries,
				Properties: dictionary(
					{},
					[nameBytes(Uint8Array.of(0x4d, 0xff)), dictionary({ MCID: 7 })],
					[nameBytes(Uint8Array.of(0x43, 0xff)), cut],
				),
				ColorSpace: dictionary(
					{},
					[tag, name("DeviceCMYK")],
					[
						name("CutInk"),
						(resources.entries.ColorSpace as PdfDictionary).entries.CutInk!,
					],
				),
			}),
	})
	const parsed = parsePdf(serializePdf(document))
	const selected = selectPdfOptionalContent(parsed, { baseState: "OFF" })
	expect(contents(selected)).toContain("/Span /M#ff BDC")
	expect(contents(selected)).toContain("/Point /M#ff DP")
	expect(contents(selected)).not.toContain("/OC ")
	expect(contents(selected)).toContain("/Artifact BMC")
	const expected = selectPdfOptionalContent(
		fixture({ source: paper }).document,
		show,
	)
	expect(
		(await renderPdf(serializePdf(selected), { resolution: 72 })).pages[0]!
			.pixels,
	).toEqual(
		(await renderPdf(serializePdf(expected), { resolution: 72 })).pages[0]!
			.pixels,
	)
})

it("resolves Form-level OC membership with page-resource fallback independently of default visibility", async () => {
	const { document, cut } = fixture({
		source: `${paper}\nq /Form Do Q`,
		resources: ({ objects, resources, cut }) =>
			dictionary({
				...resources.entries,
				XObject: dictionary({
					Form: objects.add(
						stream(
							{
								Type: name("XObject"),
								Subtype: name("Form"),
								BBox: array(0, 0, 20, 20),
								OC: cut,
							},
							ascii(`q ${technicalPath} Q`),
						),
					),
				}),
			}),
	})
	const included = selectPdfOptionalContent(document, show)
	const excluded = selectPdfOptionalContent(document, {
		baseState: "ON",
		off: [cut],
	})
	expect(contents(included)).toContain("1 1 m")
	expect(contents(excluded)).not.toContain("1 1 m")
	expect(
		(await renderPdf(serializePdf(included), { resolution: 72 })).pages[0]!
			.pixels,
	).not.toEqual(
		(await renderPdf(serializePdf(excluded), { resolution: 72 })).pages[0]!
			.pixels,
	)
	expect(
		previewPdfPlates(document, { inkOutput }).map((plate) => plate.name),
	).toEqual(["Cyan", "Magenta", "Yellow", "Black"])
})

it("retains ordinary raster XObjects alongside excluded structural paths", async () => {
	const build = (source: string) =>
		fixture({
			source,
			resources: ({ objects, resources }) =>
				dictionary({
					...resources.entries,
					XObject: dictionary({
						Image: objects.add(
							stream(
								{
									Type: name("XObject"),
									Subtype: name("Image"),
									Width: 1,
									Height: 1,
									BitsPerComponent: 8,
									ColorSpace: name("DeviceCMYK"),
								},
								Uint8Array.of(255, 0, 0, 0),
							),
						),
					}),
				}),
		}).document
	const image = "q 20 0 0 20 0 0 cm /Image Do Q"
	const selected = selectPdfOptionalContent(
		build(`${image}\n${optionalPath}`),
		{ baseState: "OFF" },
	)
	const baseline = selectPdfOptionalContent(build(image), show)
	expect(contents(selected)).toContain("/Image Do")
	expect(
		(await renderPdf(serializePdf(selected), { resolution: 72 })).pages[0]!
			.pixels,
	).toEqual(
		(await renderPdf(serializePdf(baseline), { resolution: 72 })).pages[0]!
			.pixels,
	)
})

it.each([
	["BDC arity", "/OC BDC", /Invalid BDC/],
	["unbalanced optional fragment", "/OC /Cut BDC q EMC", /balanced, complete/],
	["unfinished path", "q 0 0 m Q", /unfinished path/],
	["unmatched graphics restore", "Q", /Unbalanced Q/],
	["unclosed graphics scope", "q", /Unbalanced graphics/],
	["optional point marker", "/OC /Cut DP", /point markers/],
	[
		"fill-only technical path",
		`/OC /Cut BDC q ${technicalPath.replace(/S$/u, "f")} Q EMC`,
		/must have a stroke/,
	],
	[
		"conflicting nested membership",
		`/OC /Cut BDC q /OC /Crease BDC q ${technicalPath} Q EMC Q EMC`,
		/different processing-step/,
	],
	["unregistered membership", "/OC /Spare BDC q Q EMC", /unregistered OCG/],
	[
		"invalid path operands",
		`/OC /Cut BDC q ${technicalPath.replace("1 1 m", "1 m")} Q EMC`,
		/numeric operands/,
	],
	[
		"nonfinite geometry",
		`/OC /Cut BDC q ${technicalPath.replace("1 1 m", `${"9".repeat(400)} 1 m`)} Q EMC`,
		/finite/,
	],
] as const)(
	"rejects %s even when layers are excluded",
	(_label, source, diagnostic) => {
		expect(() =>
			selectPdfOptionalContent(fixture({ source }).document, {
				baseState: "OFF",
			}),
		).toThrow(diagnostic)
	},
)

it.each([
	[
		"alternate configurations",
		(c: FixtureContext) =>
			dictionary({ OCGs: array(c.cut, c.crease), Configs: array() }),
		/Alternate/,
	],
	[
		"usage application",
		(c: FixtureContext) =>
			dictionary({
				OCGs: array(c.cut, c.crease),
				D: dictionary({ AS: array() }),
			}),
		/usage applications/,
	],
	[
		"direct OCG",
		() => dictionary({ OCGs: array(dictionary({ Type: name("OCG") })) }),
		/indirect OCG/,
	],
	[
		"duplicate OCG",
		(c: FixtureContext) => dictionary({ OCGs: array(c.cut, c.cut) }),
		/Duplicate OCG/,
	],
	["invalid properties", () => 7, /dictionary/],
	["invalid OCG array", () => dictionary({ OCGs: name("Invalid") }), /array/],
] as const)(
	"rejects %s in imported optional-content configuration",
	(_label, properties, diagnostic) => {
		expect(() =>
			selectPdfOptionalContent(fixture({ properties }).document, show),
		).toThrow(diagnostic)
	},
)

it("validates explicit proof references and JavaScript ink policies", () => {
	const { document, spare } = fixture()
	expect(() =>
		selectPdfOptionalContent(document, { baseState: "Default" } as never),
	).toThrow(/baseState/)
	expect(() =>
		selectPdfOptionalContent(document, {
			baseState: "ON",
			on: [reference(999)],
		}),
	).toThrow(/unknown OCG/)
	expect(() =>
		selectPdfOptionalContent(document, { baseState: "ON", on: [spare] }),
	).toThrow(/unregistered OCG/)
	const pdf = createPdfDocument()
	pdf.setPages(pdf.page({ mediaBox: rectangle(0, 0, 10, 10) }))
	expect(() =>
		selectPdfOptionalContent(pdf.compile(), {
			baseState: "ON",
			on: [reference(999)],
		}),
	).toThrow(/no registered/)
	for (const [policy, diagnostic] of [
		[{}, /inkOutput requires/],
		[
			{
				processingSteps: {
					default: "error",
					rules: [{ group: "Structural", type: "Cutting", action: "guess" }],
				},
			},
			/action/,
		],
		[
			{
				processingSteps: {
					default: "error",
					rules: [
						inkOutput.processingSteps.rules[0],
						inkOutput.processingSteps.rules[0],
					],
				},
			},
			/Duplicate ink/,
		],
	] as const)
		expect(() =>
			previewPdfPlates(document, { inkOutput: policy as PdfInkOutputPolicy }),
		).toThrow(diagnostic)
})

it("rejects unsupported Form structures before selecting any output", () => {
	for (const [entries, diagnostic] of [
		[{ Group: dictionary({ S: name("Transparency") }) }, /Transparency groups/],
		[{ Ref: dictionary({}) }, /reference Forms/],
		[{ BBox: array(0, 0, 10) }, /Form BBox/],
	] as const) {
		const { document } = fixture({
			source: "/Form Do",
			resources: ({ objects, resources }) =>
				dictionary({
					...resources.entries,
					XObject: dictionary({
						Form: objects.add(
							stream(
								{
									Type: name("XObject"),
									Subtype: name("Form"),
									BBox: array(0, 0, 20, 20),
									Resources: resources,
									...entries,
								},
								ascii("q Q"),
							),
						),
					}),
				}),
		})
		expect(() => selectPdfOptionalContent(document, show)).toThrow(diagnostic)
	}
	const recursive = fixture({
		source: "/Form Do",
		resources: ({ objects, resources }) => {
			const form = objects.reserve<PdfStream>()
			const table = dictionary({
				...resources.entries,
				XObject: dictionary({ Form: form.ref }),
			})
			form.set(
				stream(
					{
						Type: name("XObject"),
						Subtype: name("Form"),
						BBox: array(0, 0, 20, 20),
						Resources: table,
					},
					ascii("/Form Do"),
				),
			)
			return table
		},
	})
	expect(() => selectPdfOptionalContent(recursive.document, show)).toThrow(
		/Recursive Form/,
	)
})

it("rejects optional-content images and technical raster painting", () => {
	for (const technical of [false, true]) {
		const { document } = fixture({
			properties: ({ cut, crease, spare }) =>
				dictionary({
					OCGs: technical ? array(cut, crease) : array(cut, crease, spare),
				}),
			source: technical ? "/OC /Cut BDC q /Image Do Q EMC" : "/Image Do",
			resources: ({ objects, resources, spare }) =>
				dictionary({
					...resources.entries,
					XObject: dictionary({
						Image: objects.add(
							stream(
								{
									Type: name("XObject"),
									Subtype: name("Image"),
									Width: 1,
									Height: 1,
									BitsPerComponent: 8,
									ColorSpace: name("DeviceCMYK"),
									...(technical ? {} : { OC: spare }),
								},
								Uint8Array.of(0, 0, 0, 0),
							),
						),
					}),
				}),
		})
		expect(() =>
			selectPdfOptionalContent(document, { baseState: "OFF" }),
		).toThrow(technical ? /non-vector XObjects/ : /non-Form XObjects/)
	}
})

it("validates inherited graphics state and stroke requirements rather than repairing imported paint", () => {
	for (const ext of [
		dictionary({ OP: true, TR: name("Identity") }),
		dictionary(
			{},
			[nameBytes(ascii("OP")), true],
			[nameBytes(ascii("TR")), name("Identity")],
		),
	]) {
		const { document } = fixture({
			resources: ({ resources }) =>
				dictionary({
					...resources.entries,
					ExtGState: dictionary({ Over: ext }),
				}),
		})
		expect(() =>
			selectPdfOptionalContent(document, { baseState: "OFF" }),
		).toThrow(/unsupported ExtGState/)
	}
	const { document } = fixture({
		source: `/OC /Cut BDC q /Over gs /CutInk CS /CutInk cs 1 SCN 1 scn 1 1 8 8 re B Q EMC`,
		resources: ({ resources }) =>
			dictionary({
				...resources.entries,
				ExtGState: dictionary({ Over: dictionary({ OP: true, OPM: 1 }) }),
			}),
	})
	expect(() => selectPdfOptionalContent(document, show)).not.toThrow()
})

it("rejects invalid JavaScript authoring configuration and accepts nested equivalent classifications", () => {
	const pdf = createPdfDocument()
	const cut = pdf.optionalContentGroup({
		name: "Cut",
		processingStep: { group: "Structural", type: "Cutting" },
	})
	const same = pdf.optionalContentGroup({
		name: "Cut again",
		processingStep: { group: "Structural", type: "Cutting" },
	})
	expect(() =>
		pdf.setOptionalContentConfiguration({ baseState: "Default" } as never),
	).toThrow(/baseState/)
	expect(() =>
		pdf.setOptionalContentConfiguration({ baseState: "ON", order: [cut, cut] }),
	).toThrow(/Duplicate/)
	expect(() => pdf.transform([1, 0, 0, 1, Infinity, 0], [])).toThrow(
		/six finite/,
	)
	expect(() =>
		pdf.form({
			bbox: rectangle(0, 0, 10, 10),
			content: [],
			matrix: [1, 0, 0, 1, NaN, 0],
		}),
	).toThrow(/six finite/)
	expect(() => pdf.optionalContent({} as PdfOptionalContentGroup, [])).toThrow(
		/Unknown optional/,
	)
	expect(() =>
		pdf.optionalContentGroup({
			name: "Cut",
			processingStep: { group: "Structural", type: "Cutting", extra: true },
		} as never),
	).toThrow(/Unknown processing/)
	const ink = separation("CutContour", {
		type: "exponential",
		zero: cmyk(0, 0, 0, 0),
		full: cmyk(0, 1, 0, 0),
		exponent: 1,
	})
	const path = pdf.graphics((g) => {
		g.paintState({
			fillOverprint: true,
			strokeOverprint: true,
			overprintMode: 1,
		})
			.spotStroke(ink, 1)
			.moveTo(1, 1)
			.lineTo(9, 9)
			.stroke()
	})
	pdf.setPages(
		pdf.page({
			mediaBox: rectangle(0, 0, 10, 10),
			content: [pdf.optionalContent(cut, [pdf.optionalContent(same, [path])])],
		}),
	)
	expect(() => pdf.compile()).not.toThrow()
})

it("resolves a one-filter Flate array and rejects unsupported stream decoding", async () => {
	const { zlibSync } = await import("fflate")
	const source = `${paper}\n${optionalPath}`
	const baseline = selectPdfOptionalContent(fixture({ source }).document, show)
	const compressed = fixture({
		page: ({ objects }) => ({
			Contents: objects.add(
				stream({ Filter: array(name("FlateDecode")) }, zlibSync(ascii(source))),
			),
		}),
	})
	expect(contents(selectPdfOptionalContent(compressed.document, show))).toBe(
		contents(baseline),
	)
	for (const entries of [
		{ Filter: name("ASCIIHexDecode") },
		{ Filter: name("FlateDecode"), DecodeParms: dictionary({}) },
	]) {
		const { document } = fixture({
			page: ({ objects }) => ({
				Contents: objects.add(stream(entries, zlibSync(ascii(source)))),
			}),
		})
		expect(() => selectPdfOptionalContent(document, show)).toThrow(
			/FlateDecode content without DecodeParms/,
		)
	}
	const empty = fixture({ page: () => ({ Contents: undefined }) }).document
	expect(contents(selectPdfOptionalContent(empty, show)).trim()).toBe("")
})

it("rejects nested technical Forms, whether membership surrounds the invocation or is inside the Form", () => {
	for (const membershipInside of [false, true]) {
		const pdf = createPdfDocument()
		const cut = pdf.optionalContentGroup({
			name: "Cut",
			processingStep: { group: "Structural", type: "Cutting" },
		})
		const ink = separation("CutContour", {
			type: "exponential",
			zero: cmyk(0, 0, 0, 0),
			full: cmyk(0, 1, 0, 0),
			exponent: 1,
		})
		const path = pdf.graphics((g) => {
			g.paintState({
				fillOverprint: true,
				strokeOverprint: true,
				overprintMode: 1,
			})
				.spotStroke(ink, 1)
				.moveTo(1, 1)
				.lineTo(9, 9)
				.stroke()
		})
		const inner = pdf.form({
			bbox: rectangle(0, 0, 10, 10),
			content: membershipInside ? [pdf.optionalContent(cut, [path])] : [path],
		})
		const outer = pdf.form({
			bbox: rectangle(0, 0, 10, 10),
			content: membershipInside ? [inner] : [pdf.optionalContent(cut, [inner])],
		})
		pdf.setPages(
			pdf.page({ mediaBox: rectangle(0, 0, 10, 10), content: [outer] }),
		)
		expect(() => pdf.compile()).toThrow(/Nested technical Forms/)
	}
})

it("rejects optional annotations and missing XObjects while preserving unsupported default color replacements", () => {
	const annotated = fixture({
		page: ({ objects, cut }) => ({
			Annots: array(
				objects.add(
					dictionary({
						Subtype: name("Text"),
						Rect: array(0, 0, 10, 10),
						OC: cut,
						Contents: textString("Note"),
					}),
				),
			),
		}),
	})
	expect(() => selectPdfOptionalContent(annotated.document, show)).toThrow(
		/Optional-content annotations/,
	)
	expect(() =>
		selectPdfOptionalContent(fixture({ source: "/Missing Do" }).document, show),
	).toThrow(/XObject stream/)
	const defaults = fixture({
		resources: ({ resources }) =>
			dictionary({
				...resources.entries,
				ColorSpace: dictionary({
					...(resources.entries.ColorSpace as PdfDictionary).entries,
					DefaultCMYK: name("DeviceCMYK"),
				}),
			}),
	})
	const selected = selectPdfOptionalContent(defaults.document, {
		baseState: "OFF",
	})
	expect(() => previewPdfPlates(selected)).toThrow(
		/Default color space replacements/,
	)
})

it("rejects raster content during semantic structural membership assignment", () => {
	const pdf = createPdfDocument()
	const cut = pdf.optionalContentGroup({
		name: "Cut",
		processingStep: { group: "Structural", type: "Cutting" },
	})
	const image = pdf.jpeg(
		readFileSync(
			new URL("../fixtures/original-corpus/garden-raster.jpg", import.meta.url),
		),
	)
	const raster = pdf.graphics((g) => {
		g.drawImage(image, 0, 0, 10, 10)
	})
	expect(() => pdf.optionalContent(cut, [raster])).toThrow(
		/cannot contain images/,
	)
})

function textClippingDocument(
	prefix: string,
	suffix = optionalPath,
): PdfDocument {
	const { document } = fixture({
		source: `${prefix}\n${suffix}`,
		resources: ({ objects, resources }) =>
			dictionary({
				...resources.entries,
				Font: dictionary({
					F: objects.add(
						dictionary({
							Type: name("Font"),
							Subtype: name("Type1"),
							BaseFont: name("Helvetica"),
						}),
					),
				}),
			}),
	})
	return parsePdf(serializePdf(document))
}
const includeTechnical: PdfInkOutputPolicy = {
	processingSteps: {
		default: "error",
		rules: inkOutput.processingSteps.rules.map((rule) => ({
			...rule,
			action: "include",
		})),
	},
}

it.each([4, 5, 6, 7])(
	"rejects persistent text clipping from rendering mode %i before proof or ink selection",
	async (mode) => {
		const document = textClippingDocument(
			`q 0 0 0 1 k 0 0 0 1 K BT /F 12 Tf ${mode} Tr 2 2 Td (H) Tj ET`,
			`${optionalPath} Q`,
		)
		for (const baseState of ["ON", "OFF"] as const)
			expect(() => selectPdfOptionalContent(document, { baseState })).toThrow(
				/clipping/,
			)
		for (const policy of [inkOutput, includeTechnical]) {
			expect(() => previewPdfPlates(document, { inkOutput: policy })).toThrow(
				/clipping/,
			)
			await expect(
				renderPdfPlateCoverage(document, { inkOutput: policy, resolution: 72 }),
			).rejects.toThrow(/clipping/)
		}
	},
)

it.each(["(H) Tj", "[(H) -20 <>] TJ", "(H) '", '0 0 (H) "'])(
	"retains pending text clipping across a rendering-mode change after %s",
	(showText) => {
		const document = textClippingDocument(
			`q 7 Tr BT /F 12 Tf 2 2 Td ${showText} 3 Tr ET`,
			`${optionalPath} Q`,
		)
		expect(() => selectPdfOptionalContent(document, show)).toThrow(/clipping/)
	},
)

it("rejects a clipped structural Form invocation using the inherited text clipping state", () => {
	const document = fixture({
		source: "q BT /F 12 Tf 7 Tr 2 2 Td (H) Tj ET /Form Do Q",
		resources: ({ objects, resources, cut }) =>
			dictionary({
				...resources.entries,
				Font: dictionary({
					F: objects.add(
						dictionary({
							Type: name("Font"),
							Subtype: name("Type1"),
							BaseFont: name("Helvetica"),
						}),
					),
				}),
				XObject: dictionary({
					Form: objects.add(
						stream(
							{
								Type: name("XObject"),
								Subtype: name("Form"),
								BBox: array(0, 0, 20, 20),
								Resources: resources,
								OC: cut,
							},
							ascii(`q ${technicalPath} Q`),
						),
					),
				}),
			}),
	}).document
	expect(() =>
		selectPdfOptionalContent(parsePdf(serializePdf(document)), show),
	).toThrow(/clipping/)
})

it("restores text clipping with Q before structural painting, preserving exact proof pixels and plate coverage", async () => {
	const document = textClippingDocument("q BT /F 12 Tf 7 Tr 2 2 Td (H) Tj ET Q")
	const baseline = fixture({ source: optionalPath }).document
	const shown = selectPdfOptionalContent(document, show)
	const expected = selectPdfOptionalContent(baseline, show)
	const proof = await renderPdf(serializePdf(shown), { resolution: 72 })
	const control = await renderPdf(serializePdf(expected), { resolution: 72 })
	expect(proof.pages[0]!.pixels).toEqual(control.pages[0]!.pixels)
	const actualPlates = await renderPdfPlateCoverage(document, {
		inkOutput: includeTechnical,
		resolution: 72,
	})
	const expectedPlates = await renderPdfPlateCoverage(baseline, {
		inkOutput: includeTechnical,
		resolution: 72,
	})
	expect(actualPlates.plates.map((plate) => plate.name)).toEqual(
		expectedPlates.plates.map((plate) => plate.name),
	)
	for (const [index, plate] of actualPlates.plates.entries())
		expect(plate.pages[0]!.samples).toEqual(
			expectedPlates.plates[index]!.pages[0]!.samples,
		)
	expect(
		actualPlates.plates
			.find((plate) => plate.name === "CutContour")!
			.pages[0]!.samples.some((sample) => sample < 255),
	).toBe(true)
})

it.each(["() Tj", "[100 () -20 <>] TJ", "() '", '0 0 () "'])(
	"does not establish text clipping for empty text shown with %s",
	(showText) => {
		const document = textClippingDocument(
			`q BT /F 12 Tf 7 Tr 2 2 Td ${showText} ET`,
			`${optionalPath} Q`,
		)
		expect(() => selectPdfOptionalContent(document, show)).not.toThrow()
	},
)

it("retains the text rendering mode across BT/ET and restores it with q/Q", () => {
	const persistent = textClippingDocument(
		"7 Tr BT /F 12 Tf () Tj ET BT /F 12 Tf 2 2 Td (H) Tj ET",
	)
	expect(() => selectPdfOptionalContent(persistent, show)).toThrow(/clipping/)
	const restored = textClippingDocument(
		"q 7 Tr Q BT /F 12 Tf 0 0 0 1 k 2 2 Td (H) Tj ET",
	)
	expect(() => selectPdfOptionalContent(restored, show)).not.toThrow()
})

it.each([
	["BT BT", /Nested BT/],
	["ET", /ET without BT/],
	["BT", /Unbalanced.*text object/],
	["(H) Tj", /requires a BT\/ET/],
	["8 Tr", /integer from 0 to 7/],
	["0.5 Tr", /integer from 0 to 7/],
] as const)(
	"rejects malformed text state while resolving optional content: %s",
	(source, diagnostic) => {
		expect(() =>
			selectPdfOptionalContent(textClippingDocument(source), show),
		).toThrow(diagnostic)
	},
)
