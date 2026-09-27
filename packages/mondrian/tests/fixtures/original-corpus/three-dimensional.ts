// SPDX-License-Identifier: MPL-2.0
import { readFileSync } from "node:fs"
import { pdfBytes, WirePdf } from "./wire.ts"

export const tetrahedronHash =
	"2d94c5efad647591b46ea73f3c4070401b0f3b3f04b37593b698ac3fb7258209"
export const tetrahedron = () =>
	Uint8Array.from(
		readFileSync(new URL("./moss-tetrahedron.prc", import.meta.url)),
	)

export function threeDimensionalParcel(): Uint8Array {
	const pdf = new WirePdf()
	pdf.add(1, "<< /Type /Catalog /Pages 2 0 R >>")
	pdf.add(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
	pdf.add(
		3,
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 240] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R /Annots [6 0 R] >>",
	)
	pdf.stream(
		4,
		"",
		"BT /F1 18 Tf 20 210 Td (A parcel in three dimensions) Tj /F1 10 Tf 0 -20 Td (Original PRC mesh: four vertices, four faces) Tj 0 -170 Td (Static preview of the attached tetrahedron) Tj ET",
	)
	pdf.add(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
	pdf.add(
		6,
		"<< /Type /Annot /Subtype /3D /Rect [60 45 300 175] /F 4 /Contents (Moss tetrahedron) /3DD 7 0 R /3DV 8 0 R /3DA << /A /XA /DIS /I >> /AP << /N 9 0 R >> >>",
	)
	pdf.stream(
		7,
		"/Type /3D /Subtype /PRC /VA [8 0 R] /DV 0",
		tetrahedron(),
		true,
	)
	pdf.add(
		8,
		"<< /Type /3DView /XN (Moss tetrahedron) /IN (default) /MS /M /C2W [1 0 0 0 1 0 0 0 1 0 0 10] /CO 10 /P << /Subtype /O /OS 30 >> /BG << /Type /3DBG /Subtype /SC /CS /DeviceRGB /C [1 1 1] >> >>",
	)
	// An original 2D projection is the annotation appearance; PDFium does not render PRC.
	pdf.stream(
		9,
		"/Type /XObject /Subtype /Form /BBox [0 0 240 130] /Resources << >>",
		"q 0.07 0.25 0.18 RG 1 w 0.15 0.65 0.45 rg 30 35 m 190 15 l 95 120 l h B 0.09 0.42 0.29 rg 190 15 m 215 65 l 95 120 l h B 0.40 0.78 0.59 rg 30 35 m 95 120 l 215 65 l h B Q",
	)
	return pdfBytes(pdf.write())
}
