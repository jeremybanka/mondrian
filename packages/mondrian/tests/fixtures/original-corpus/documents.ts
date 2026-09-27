// SPDX-License-Identifier: MPL-2.0
import { readFileSync } from "node:fs"
import { deflateSync } from "node:zlib"
import { createPdfDocument, rectangle, rgb } from "../../../src/index.ts"
import type {
	PdfParseOptions,
	PdfValidationOptions,
} from "../../../src/index.ts"
import { prismWorkshop } from "./color.ts"
import { encryptedPdf } from "../encrypted.ts"
import {
	appendRevision,
	ascii85,
	hexUtf16,
	hexUtf8,
	pdfBytes,
	WirePdf,
} from "./wire.ts"

export interface OriginalFixture {
	readonly id: string
	readonly build: () => Uint8Array
	readonly pages: readonly {
		width: number
		height: number
		rotation: number
		text: string
	}[]
	readonly names: readonly string[]
	readonly parseOptions?: PdfParseOptions
	readonly validationOptions?: PdfValidationOptions
	readonly recoveryWarnings?: readonly string[]
	readonly dateWarnings?: number
}
const page = (text: string, width = 360, height = 240, rotation = 0) => ({
	width,
	height,
	rotation,
	text,
})

function fieldNotes(): Uint8Array {
	const pdf = createPdfDocument({
		version: "1.3",
		metadata: {
			title: "Field notes from the pocket observatory",
			author: "The imaginary Moss Bureau",
			creationDate: new Date("2026-09-01T12:00:00Z"),
		},
	})
	const heading = pdf.standardFont("Helvetica-Bold")
	const body = pdf.standardFont("Times-Roman")
	const mono = pdf.standardFont("Courier")
	const text = (value: string, x: number, y: number, size = 10, font = body) =>
		pdf.text((t) => t.font(font, size).moveText(x, y).show(value))
	const first = pdf.page({
		mediaBox: rectangle(0, 0, 360, 240),
		content: [
			text("The pocket observatory", 20, 210, 19, heading),
			text("Notebook 07 / fictional field research", 20, 190),
			text("We counted the shadows of six paper moons.", 20, 160),
			text("Each moon waited quietly beside a blue square.", 20, 145),
			text("Trial", 20, 112, 11, heading),
			text("Moons", 130, 112, 11, heading),
			text("Minutes", 240, 112, 11, heading),
			...[1, 2, 3].flatMap((n) => [
				text(`M-${n}`, 20, 110 - n * 20, 10, mono),
				text(String(n * 2), 130, 110 - n * 20),
				text(String(n * n + 2), 240, 110 - n * 20),
			]),
			pdf.graphics((g) =>
				g
					.strokeColor(rgb(0.15, 0.35, 0.5))
					.lineWidth(1)
					.moveTo(20, 103)
					.lineTo(335, 103)
					.stroke(),
			),
		],
	})
	const second = pdf.page({
		mediaBox: rectangle(0, 0, 360, 240),
		content: [
			text("A very small result", 20, 210, 19, heading),
			text("Column one", 20, 180, 11, heading),
			text("Column two", 190, 180, 11, heading),
			text("Paper moons prefer tidy rows.", 20, 160),
			text("No real moon was measured.", 190, 160),
			text("score = 2 * shade + 1", 20, 135, 10, mono),
			pdf.graphics((g) =>
				g
					.fillColor(rgb(0.15, 0.5, 0.65))
					.rectangle(30, 40, 50, 30)
					.fill()
					.rectangle(100, 40, 50, 60)
					.fill()
					.rectangle(170, 40, 50, 80)
					.fill(),
			),
		],
	})
	const third = pdf.page({
		mediaBox: rectangle(0, 0, 240, 360),
		rotation: 90,
		content: [
			text("Rotated appendix", 20, 320, 18, heading),
			text("End of the invented expedition.", 20, 295),
		],
	})
	return pdf.setPages(first, pdf.pages(second, third)).serialize()
}

function simple(title: string, version = "1.7"): WirePdf {
	return new WirePdf(version)
		.add(1, "<< /Type /Catalog /Pages 2 0 R >>")
		.add(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
		.add(
			3,
			"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 240] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
		)
		.stream(
			4,
			"",
			`BT /F1 18 Tf 24 195 Td (${title}) Tj ET\nq 0.1 0.5 0.6 rg 24 50 180 90 re f Q\n`,
			true,
		)
		.add(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
}

function storage(hybrid: boolean): Uint8Array {
	const pdf = simple("Ledger of imaginary parcels", "1.5")
	pdf.objects.set(
		1,
		"<< /Type /Catalog /Pages 2 0 R /Names << /Dests 6 0 R >> /Outlines 7 0 R >>",
	)
	pdf.add(6, "<< /Names [(arrival) [3 0 R /XYZ 0 240 null]] >>")
	pdf.add(7, "<< /Type /Outlines /First 8 0 R /Last 8 0 R /Count 1 >>")
	pdf.add(8, "<< /Title (Arrival) /Parent 7 0 R /Dest (arrival) >>")
	return pdfBytes(pdf.write({ compressed: [5, 6, 7, 8], hybrid }))
}

function metadata(mode: "utf8" | "utf16" | "historic" | "quartz"): Uint8Array {
	const pdf = simple("Clockwork garden log", mode === "utf8" ? "2.0" : "1.7")
	// Two streams reached through an indirect Contents array reproduce the validator defect.
	pdf.objects.set(
		3,
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 240] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
	)
	pdf
		.add(6, "[4 0 R 7 0 R]")
		.stream(
			7,
			"",
			"BT /F1 11 Tf 24 25 Td (The clock grows one leaf per hour.) Tj ET\n",
		)
	const date =
		mode === "utf8"
			? hexUtf8("D:20260901120000Z")
			: mode === "utf16"
				? hexUtf16("D:20260901120000Z")
				: mode === "quartz"
					? "(D:20260901120000Z00'00')"
					: "(Tuesday at the first falling leaf)"
	pdf.add(8, "<< /Title 9 0 R /CreationDate 10 0 R /Trapped 11 0 R >>")
	pdf.add(
		9,
		mode === "utf8"
			? hexUtf8("Jardin de poche — 山")
			: hexUtf16("Jardin de poche — 山"),
	)
	pdf.add(10, date).add(11, "/False")
	return pdfBytes(
		pdf.write({
			trailer: "/Info 8 0 R",
			...(mode === "quartz" ? { zeroOffset: 12 } : {}),
		}),
	)
}

export const receiptXml =
	'<?xml version="1.0"?><receipt id="MOSS-007"><item quantity="3">Paper moon</item><total currency="TOK">21</total></receipt>'
export const formScript = "this.getField('parcel').value = 'MOSS-007';"
function parcel(): Uint8Array {
	const pdf = simple("Receipt from the Moss Bureau")
	pdf.objects.set(
		1,
		"<< /Type /Catalog /Pages 2 0 R /AcroForm 6 0 R /Names << /EmbeddedFiles 10 0 R /JavaScript 14 0 R >> /AF [9 0 R] /Collection << /Type /Collection /View /D >> /MarkInfo << /Marked true >> /StructTreeRoot 16 0 R /Lang (en) >>",
	)
	pdf.objects.set(
		3,
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 240] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R /Annots [7 0 R 18 0 R] /StructParents 0 >>",
	)
	pdf.objects.set(
		4,
		new WirePdf()
			.stream(
				4,
				"",
				"/P << /MCID 0 >> BDC BT /F1 18 Tf 24 195 Td (Receipt from the Moss Bureau) Tj ET EMC\nBT /F1 11 Tf 24 160 Td (Three paper moons: 21 tokens) Tj ET\nq 0.9 0.95 1 rg 24 100 176 30 re f 0 g BT /F1 12 Tf 32 110 Td (MOSS-007) Tj ET Q\n",
			)
			.objects.get(4)!,
	)
	pdf.add(
		6,
		"<< /Fields [7 0 R] /NeedAppearances false /DR << /Font << /F1 5 0 R >> >> /DA (/F1 12 Tf 0 g) /XFA 13 0 R >>",
	)
	pdf.add(
		7,
		"<< /Type /Annot /Subtype /Widget /FT /Tx /T (parcel) /V (MOSS-007) /Rect [24 100 200 130] /P 3 0 R /F 4 /AP << /N 8 0 R >> >>",
	)
	pdf.stream(
		8,
		"/Type /XObject /Subtype /Form /BBox [0 0 176 30] /Resources << /Font << /F1 5 0 R >> >>",
		"0.9 0.95 1 rg 0 0 176 30 re f 0 g BT /F1 12 Tf 8 10 Td (MOSS-007) Tj ET",
	)
	pdf.add(
		9,
		"<< /Type /Filespec /F (receipt.xml) /UF (receipt.xml) /Desc (Invented receipt data) /AFRelationship /Data /EF << /F 11 0 R >> >>",
	)
	pdf.add(10, "<< /Names [(receipt.xml) 9 0 R (ticket.pdf) 20 0 R] >>")
	pdf.stream(
		11,
		"/Type /EmbeddedFile /Subtype /application#2Fxml",
		receiptXml,
		true,
	)
	pdf.stream(
		13,
		"",
		'<?xml version="1.0"?><xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"><datasets xmlns="http://www.xfa.org/schema/xfa-data/1.0/"><data><parcel>MOSS-007</parcel></data></datasets></xdp:xdp>',
	)
	pdf.add(14, "<< /Names [(set-parcel) 15 0 R] >>")
	pdf.add(15, `<< /S /JavaScript /JS (${formScript}) >>`)
	pdf.add(
		16,
		"<< /Type /StructTreeRoot /K [17 0 R] /ParentTree << /Nums [0 [17 0 R]] >> >>",
	)
	pdf.add(17, "<< /Type /StructElem /S /P /P 16 0 R /Pg 3 0 R /K 0 >>")
	pdf.add(
		18,
		"<< /Type /Annot /Subtype /Link /Rect [24 20 220 45] /Border [0 0 0] /A << /S /URI /URI (https://example.invalid/moss) >> >>",
	)
	pdf.stream(
		19,
		"/Type /EmbeddedFile /Subtype /application#2Fpdf",
		simple("A ticket to nowhere").write(),
	)
	pdf.add(20, "<< /Type /Filespec /F (ticket.pdf) /EF << /F 19 0 R >> >>")
	return pdfBytes(
		pdf.write({ compressed: [5, 6, 7, 9, 10, 14, 15, 16, 17, 18, 20] }),
	)
}

function archive(): Uint8Array {
	const pdf = simple("The invented lantern archive", "1.4")
	const pixels = Uint8Array.from({ length: 96 * 48 }, (_, i) => {
		const x = i % 96,
			y = Math.floor(i / 96)
		const border = x === 3 || x === 92 || y === 3 || y === 44
		const ink =
			y > 10 &&
			y < 36 &&
			((x > 15 && x < 24) ||
				(x > 32 && x < 41) ||
				(x > 49 && x < 58) ||
				(x > 66 && x < 75) ||
				(y > 29 && x > 15 && x < 84))
		return border || ink ? 35 : 244 - ((x * 7 + y * 3) % 9)
	})
	pdf.objects.set(
		1,
		"<< /Type /Catalog /Pages 2 0 R /MarkInfo << /Marked true >> /StructTreeRoot 7 0 R /Lang (en) >>",
	)
	pdf.objects.set(
		3,
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 240] /Resources << /Font << /F1 5 0 R >> /XObject << /Scan 6 0 R >> >> /Contents 4 0 R /StructParents 0 >>",
	)
	pdf.objects.delete(4)
	pdf.stream(
		4,
		"",
		"BT /F1 18 Tf 24 205 Td (The invented lantern archive) Tj ET\n/Figure << /MCID 0 >> BDC q 288 0 0 144 24 40 cm /Scan Do Q EMC\n/P << /MCID 1 >> BDC BT /F1 12 Tf 3 Tr 40 60 Td (Four lanterns on the shelf) Tj ET EMC\n",
		true,
	)
	pdf.stream(
		6,
		"/Type /XObject /Subtype /Image /Width 96 /Height 48 /BitsPerComponent 8 /ColorSpace /DeviceGray /Filter [/ASCII85Decode /FlateDecode]",
		ascii85(deflateSync(pixels)),
	)
	pdf.add(
		7,
		"<< /Type /StructTreeRoot /K [8 0 R 9 0 R] /ParentTree << /Nums [0 [8 0 R 9 0 R]] >> >>",
	)
	pdf.add(
		8,
		"<< /Type /StructElem /S /Figure /P 7 0 R /Pg 3 0 R /K 0 /Alt (Four geometric lanterns drawn for this test) >>",
	)
	pdf.add(9, "<< /Type /StructElem /S /P /P 7 0 R /Pg 3 0 R /K 1 >>")
	return pdfBytes(pdf.write())
}

function glyphGarden(): Uint8Array {
	const pdf = simple("Glyph garden", "1.2")
	pdf.objects.set(
		3,
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 240] /Resources << /Font << /F1 5 0 R /Garden 6 0 R >> >> /Contents 4 0 R >>",
	)
	pdf.objects.delete(4)
	pdf.stream(
		4,
		"",
		"BT /F1 18 Tf 24 200 Td (Glyph garden) Tj ET\nBT /Garden 80 Tf 24 80 Td <414243> Tj ET\n",
	)
	pdf.add(
		6,
		"<< /Type /Font /Subtype /Type3 /FontBBox [0 0 600 700] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << /mountain 7 0 R /three 8 0 R /alif 9 0 R >> /Encoding << /Type /Encoding /Differences [65 /mountain /three /alif] >> /FirstChar 65 /LastChar 67 /Widths [650 650 650] /Resources << /XObject << /Glyph 11 0 R >> >> /ToUnicode 10 0 R >>",
	)
	pdf.stream(
		7,
		"",
		"650 0 0 0 600 700 d1 70 80 60 430 re 270 80 60 580 re 470 80 60 430 re 70 80 460 60 re f",
	)
	pdf.stream(8, "", "650 0 0 0 600 700 d1 q 600 0 0 700 0 0 cm /Glyph Do Q")
	pdf.stream(9, "", "650 0 0 0 600 700 d1 250 70 70 580 re f")
	pdf.stream(
		10,
		"",
		"/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Original) /Ordering (Garden) /Supplement 0 >> def /CMapName /Garden def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange 3 beginbfchar <41> <5C71> <42> <4E09> <43> <0627> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end",
	)
	pdf.stream(
		11,
		"/Type /XObject /Subtype /Image /Width 8 /Height 8 /ImageMask true /BitsPerComponent 1 /Decode [1 0]",
		Uint8Array.of(0, 0x7e, 0, 0x3c, 0, 0x7e, 0, 0),
	)
	return pdfBytes(pdf.write())
}

function atlas(): Uint8Array {
	const pdf = simple("Map of a place that does not exist", "1.6")
	pdf.objects.set(
		1,
		"<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [6 0 R] /D << /Name (Imaginary terrain) /BaseState /ON /Order [6 0 R] >> >> >>",
	)
	pdf.objects.set(
		3,
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 864 1296] /Resources << /Font << /F1 5 0 R >> /Properties << /Terrain 6 0 R >> >> /Contents 4 0 R /VP [7 0 R] >>",
	)
	pdf.objects.delete(4)
	const grid = Array.from(
		{ length: 9 },
		(_, i) =>
			`80 ${180 + i * 100} m 780 ${180 + i * 100} l ${80 + i * 80} 180 m ${80 + i * 80} 1080 l S`,
	).join("\n")
	pdf.stream(
		4,
		"",
		`BT /F1 28 Tf 60 1210 Td (Map of a place that does not exist) Tj ET\n/OC /Terrain BDC q 0.75 0.9 0.8 rg 80 180 700 900 re f 0.3 0.6 0.4 RG 1 w ${grid}\n0.1 0.3 0.5 RG 8 w 120 220 m 350 430 l 230 660 l 640 930 l S Q EMC\nBT /F1 20 Tf 100 1130 Td (Cloud Creek / invented coordinates) Tj ET\n`,
		true,
	)
	pdf.add(6, "<< /Type /OCG /Name (Terrain) >>")
	pdf.add(
		7,
		"<< /Type /Viewport /Name (Cloud Creek) /BBox [80 180 780 1080] /Measure 8 0 R >>",
	)
	pdf.add(
		8,
		"<< /Type /Measure /Subtype /GEO /Bounds [0 0 0 1 1 1 1 0] /GPTS [10 20 11 20 11 21 10 21] /LPTS [0 0 0 1 1 1 1 0] /GCS << /Type /GEOGCS /EPSG 4326 >> >>",
	)
	return pdfBytes(pdf.write())
}

function rasterPostcard(): Uint8Array {
	const pdf = createPdfDocument({ version: "1.3" })
	const font = pdf.standardFont("Helvetica")
	const raster = pdf.jpeg(
		Uint8Array.from(
			readFileSync(new URL("garden-raster.jpg", import.meta.url)),
		),
	)
	return pdf
		.setPages(
			pdf.page({
				mediaBox: rectangle(0, 0, 360, 240),
				content: [
					pdf.text((t) =>
						t
							.font(font, 18)
							.moveText(24, 205)
							.show("A postcard from the pixel garden"),
					),
					pdf.graphics((g) => g.drawImage(raster, 24, 30, 240, 160)),
				],
			}),
		)
		.serialize()
}

export const originalFixtures: readonly OriginalFixture[] = [
	{
		id: "pixel-postcard",
		build: rasterPostcard,
		pages: [page("A postcard from the pixel garden")],
		names: ["DCTDecode", "Image", "DeviceRGB"],
	},
	{
		id: "field-notes",
		build: fieldNotes,
		pages: [
			page("The pocket observatory"),
			page("A very small result"),
			page("Rotated appendix", 360, 240, 90),
		],
		names: ["Type1", "Helvetica-Bold", "Times-Roman", "Courier"],
	},
	{
		id: "streamed-ledger",
		build: () => storage(false),
		pages: [page("Ledger of imaginary parcels")],
		names: ["Outlines", "XYZ"],
	},
	{
		id: "hybrid-ledger",
		build: () => storage(true),
		pages: [page("Ledger of imaginary parcels")],
		names: ["Outlines", "XYZ"],
	},
	{
		id: "incremental-garden",
		build: () =>
			pdfBytes(
				appendRevision(
					simple("A second season", "1.4").write(),
					"<< /Type /Catalog /Pages 2 0 R /Version /2.0 >>",
				),
			),
		pages: [page("A second season")],
		names: ["2.0"],
	},
	{
		id: "prefixed-ticket",
		build: () =>
			pdfBytes(
				"An invented transport envelope.\n".repeat(7) +
					simple("A ticket in an envelope").write(),
			),
		parseOptions: { recover: true },
		recoveryWarnings: ["leading-bytes"],
		pages: [page("A ticket in an envelope")],
		names: ["Type1"],
	},
	...(["utf8", "utf16", "historic", "quartz"] as const).map((mode) => ({
		id: `metadata-${mode}`,
		build: () => metadata(mode),
		pages: [page("Clockwork garden log")],
		names: ["False"],
		...(["historic", "quartz"].includes(mode)
			? { validationOptions: { preserveInvalidDates: true }, dateWarnings: 1 }
			: {}),
		...(mode === "quartz"
			? {
					parseOptions: { recover: true },
					recoveryWarnings: ["zero-offset-object"],
				}
			: {}),
	})),
	{
		id: "parcel-receipt",
		build: parcel,
		pages: [page("Receipt from the Moss Bureau")],
		names: [
			"Widget",
			"JavaScript",
			"EmbeddedFile",
			"Collection",
			"StructTreeRoot",
			"Link",
			"Form",
			"Filespec",
		],
	},
	{
		id: "lantern-archive",
		build: archive,
		pages: [page("Four lanterns on the shelf")],
		names: [
			"Image",
			"DeviceGray",
			"StructElem",
			"Figure",
			"FlateDecode",
			"ASCII85Decode",
		],
	},
	{
		id: "glyph-garden",
		build: glyphGarden,
		pages: [page("ا山三")],
		names: ["Type3", "Image"],
	},
	{
		id: "cloud-creek-atlas",
		build: atlas,
		pages: [page("Map of a place that does not exist", 864, 1296)],
		names: ["OCG", "Viewport", "GEO"],
	},
	{
		id: "prism-workshop",
		build: prismWorkshop,
		pages: [page("The prism workshop")],
		names: [
			"CalRGB",
			"Lab",
			"Indexed",
			"Separation",
			"DeviceN",
			"ICCBased",
			"Transparency",
			"Multiply",
			"Pattern",
			"OutputIntent",
			"ON",
		],
	},
	{
		id: "encrypted-tile-r6",
		build: () => pdfBytes(encryptedPdf().source),
		pages: [page("", 40, 40)],
		names: ["Sig", "Metadata", "FlateDecode"],
	},
	{
		id: "encrypted-tile-r5",
		build: () => pdfBytes(encryptedPdf({ vector: 0 }).source),
		parseOptions: { password: "reader" },
		pages: [page("", 40, 40)],
		names: ["Sig", "Metadata", "FlateDecode"],
	},
]
