// SPDX-License-Identifier: MPL-2.0
import {
	gardenCff,
	gardenGlyphs,
	gardenTrueType,
	glyphIndex,
} from "./font-programs.ts"
import type { OriginalFixture } from "./documents.ts"
import { pdfBytes, WirePdf } from "./wire.ts"

const encode = (keys: readonly string[]) =>
	`<${keys.map((key) => glyphIndex(key).toString(16).padStart(4, "0")).join("")}>`
const text = (
	font: string,
	value: string | readonly string[],
	x: number,
	y: number,
	size = 16,
) =>
	`BT /${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm ${encode(typeof value === "string" ? value.split("") : value)} Tj ET`
const mapping = () => `/CIDInit /ProcSet findresource begin
12 dict begin begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /MossUnicode def /CMapType 2 def
1 begincodespacerange <0000> <FFFF> endcodespacerange
${gardenGlyphs.length} beginbfchar
${gardenGlyphs.map((glyph, index) => `<${index.toString(16).padStart(4, "0")}> <${Buffer.from(glyph.unicode, "utf16le").swap16().toString("hex")}>`).join("\n")}
endbfchar endcmap CMapName currentdict /CMap defineresource pop end end`

/** Two entirely original pages: embedded CID TrueType multilingual notes, CID CFF math. */
export function embeddedFontNotebook(blank?: "truetype" | "cff"): Uint8Array {
	const pdf = new WirePdf("1.7")
	pdf.add(1, "<< /Type /Catalog /Pages 2 0 R >>")
	pdf.add(2, "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>")
	pdf.add(
		3,
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 540 540] /Resources << /Font << /T 10 0 R >> >> /Contents 5 0 R >>",
	)
	pdf.add(
		4,
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 540 540] /Resources << /Font << /C 20 0 R >> >> /Contents 6 0 R >>",
	)
	const multilingual = [
		"0.10 0.26 0.32 rg",
		text("T", "MOSS LANGUAGE NOTEBOOK", 28, 498, 24),
		text("T", "ORIGINAL EMBEDDED TRUETYPE", 28, 467, 12),
		"0.85 0.93 0.88 rg 28 334 484 104 re f 0.08 0.22 0.16 rg",
		text("T", "山川日月", 45, 380, 36),
		text("T", "木火土金水", 262, 380, 36),
		text("T", "山の川と月", 45, 345, 24),
		text("T", "RIVER / MOUNTAIN / MOON", 28, 305, 17),
		text("T", "PRE SHAPED ARABIC", 28, 262, 15),
		// Visual order is left-to-right; each glyph's ToUnicode is logical Arabic.
		// PDFium normalizes the presentation-form lam-alef mapping during extraction.
		text(
			"T",
			["meem.isolated", "lam_alef.final", "seen.initial"],
			338,
			202,
			58,
		),
		text("T", ["baa.isolated", "alef.final", "baa.initial"], 150, 202, 58),
		text("T", "PEACE / DOOR", 28, 160, 15),
		text("T", ["seal"], 28, 74, 70),
		text("T", "A PRIVATE GARDEN SEAL", 116, 106, 17),
		text("T", "TWO OUTLINES / ONE MEANING", 116, 78, 12),
		"0.10 0.26 0.32 RG 28 48 m 512 48 l S",
		text("T", "01", 472, 23, 14),
	].join("\n")
	const mathematics = [
		"0.25 0.14 0.32 rg",
		text("C", "PAPER MOON MATHEMATICS", 28, 498, 24),
		text("C", "ORIGINAL EMBEDDED CID CFF", 28, 467, 12),
		text("C", "A SMALL IDENTITY", 28, 412, 16),
		text("C", "X", 45, 357, 36),
		text("C", "2", 69, 377, 17),
		text("C", "+ Y", 94, 357, 36),
		text("C", "2", 152, 377, 17),
		text("C", "= R", 179, 357, 36),
		text("C", "2", 242, 377, 17),
		text("C", "Σ", 46, 259, 60),
		text("C", "N", 61, 308, 14),
		text("C", "I = 1", 40, 239, 12),
		text("C", "I =", 99, 268, 28),
		text("C", "N(N+1)", 174, 292, 24),
		text("C", "2", 216, 250, 24),
		"1 w 166 282 m 280 282 l S",
		text("C", "∫", 328, 262, 58),
		text("C", "1", 350, 310, 13),
		text("C", "0", 329, 241, 13),
		text("C", "X DX =", 374, 278, 20),
		text("C", "1", 466, 301, 16),
		text("C", "2", 466, 261, 16),
		"459 288 m 485 288 l S",
		text("C", "α + π = √(X)", 45, 180, 29),
		text("C", "GLYPHS FOLLOW POSITIONED TEXT", 28, 129, 12),
		text("C", ["seal"], 28, 65, 54),
		text("C", "山川日月", 114, 70, 34),
		"28 48 m 512 48 l S",
		text("C", "02", 472, 23, 14),
	].join("\n")
	pdf.stream(5, "", multilingual, true).stream(6, "", mathematics, true)
	pdf.stream(7, "", mapping(), true)
	for (const [base, cff] of [
		[10, false],
		[20, true],
	] as const) {
		const name = cff ? "MOSSCC+MossGeometry-CID" : "MOSSTT+MossGeometry-Regular"
		pdf.add(
			base,
			`<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${base + 1} 0 R] /ToUnicode 7 0 R >>`,
		)
		pdf.add(
			base + 1,
			`<< /Type /Font /Subtype /${cff ? "CIDFontType0" : "CIDFontType2"} /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${base + 2} 0 R /DW 650 /W [0 [${gardenGlyphs.map((glyph) => glyph.width).join(" ")}]] ${cff ? "" : "/CIDToGIDMap /Identity"} >>`,
		)
		pdf.add(
			base + 2,
			`<< /Type /FontDescriptor /FontName /${name} /Flags 4 /FontBBox [0 -200 900 900] /ItalicAngle 0 /Ascent 900 /Descent -200 /CapHeight 700 /StemV 58 /FontFile${cff ? 3 : 2} ${base + 3} 0 R >>`,
		)
		const font = cff
			? gardenCff(blank === "cff")
			: gardenTrueType(blank === "truetype")
		pdf.stream(
			base + 3,
			cff ? "/Subtype /CIDFontType0C" : `/Length1 ${font.length}`,
			font,
			true,
		)
	}
	return pdfBytes(pdf.write())
}

export const embeddedFontFixtures: readonly OriginalFixture[] = [
	{
		id: "embedded-font-notebook",
		build: () => embeddedFontNotebook(),
		pages: [
			{ width: 540, height: 540, rotation: 0, text: "MOSS LANGUAGE NOTEBOOK" },
			{ width: 540, height: 540, rotation: 0, text: "PAPER MOON MATHEMATICS" },
		],
		names: [
			"Type0",
			"CIDFontType2",
			"CIDFontType0",
			"CIDFontType0C",
			"Identity-H",
		],
	},
]
