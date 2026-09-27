// SPDX-License-Identifier: MPL-2.0
import { WirePdf, pdfBytes } from "./wire.ts"

/** Original minimal RGB matrix/shaper ICC v2 profile; no external profile bytes. */
export function gardenProfile(): Uint8Array {
	const xyz = (x: number, y: number, z: number) => {
		const data = Buffer.alloc(20)
		data.write("XYZ ")
		for (const [index, value] of [x, y, z].entries())
			data.writeInt32BE(Math.round(value * 65536), 8 + 4 * index)
		return data
	}
	const curve = Buffer.alloc(14)
	curve.write("curv")
	curve.writeUInt32BE(1, 8)
	curve.writeUInt16BE(Math.round(2.2 * 256), 12)
	const copyright = Buffer.from(
		"text\0\0\0\0Original Mondrian fixture profile\0",
		"ascii",
	)
	const description = Buffer.alloc(128)
	description.write("desc")
	description.writeUInt32BE(20, 8)
	description.write("Garden RGB fixture\0", 12)
	const tags: [string, Buffer][] = [
		["desc", description],
		["cprt", copyright],
		["wtpt", xyz(0.9642, 1, 0.8249)],
		["rXYZ", xyz(0.4361, 0.2225, 0.0139)],
		["gXYZ", xyz(0.3851, 0.7169, 0.0971)],
		["bXYZ", xyz(0.1431, 0.0606, 0.7141)],
		["rTRC", curve],
		["gTRC", curve],
		["bTRC", curve],
	]
	let offset = 132 + 12 * tags.length
	const table = Buffer.alloc(offset)
	table.writeUInt32BE(0x02100000, 8)
	table.write("mntr", 12)
	table.write("RGB ", 16)
	table.write("XYZ ", 20)
	for (const [index, value] of [2026, 9, 1, 12, 0, 0].entries())
		table.writeUInt16BE(value, 24 + index * 2)
	table.write("acsp", 36)
	table.write("APPL", 40)
	table.writeUInt32BE(1, 64)
	xyz(0.9642, 1, 0.8249).copy(table, 68, 8)
	table.writeUInt32BE(tags.length, 128)
	const chunks: Buffer[] = [table]
	for (const [index, [name, data]] of tags.entries()) {
		table.write(name, 132 + index * 12)
		table.writeUInt32BE(offset, 136 + index * 12)
		table.writeUInt32BE(data.length, 140 + index * 12)
		const padded = Buffer.alloc(Math.ceil(data.length / 4) * 4)
		data.copy(padded)
		chunks.push(padded)
		offset += padded.length
	}
	table.writeUInt32BE(offset, 0)
	return Uint8Array.from(Buffer.concat(chunks))
}

export function prismWorkshop(): Uint8Array {
	const pdf = new WirePdf("2.0")
	pdf.add(1, "<< /Type /Catalog /Pages 2 0 R /OutputIntents [16 0 R] >>")
	pdf.add(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
	pdf.add(
		3,
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 240] /Contents 4 0 R /OutputIntents [16 0 R] /Group << /S /Transparency /CS /DeviceRGB >> /Resources << /Font << /F1 5 0 R >> /ColorSpace << /Cal [/CalRGB << /WhitePoint [0.9505 1 1.089] /Gamma [2.2 2.2 2.2] >>] /Lab [/Lab << /WhitePoint [0.9505 1 1.089] /Range [-100 100 -100 100] >>] /Index [/Indexed /DeviceRGB 2 <206090c0d080b04040>] /Spot [/Separation /Moss /DeviceCMYK 6 0 R] /Duo [/DeviceN [/Moss /Night] /DeviceCMYK 7 0 R] /ICC [/ICCBased 15 0 R] >> /ExtGState << /Blend << /Type /ExtGState /ca 0.6 /CA 0.6 /BM /Multiply /OP true /op true /OPM 1 /UseBlackPtComp /ON >> /Mask << /Type /ExtGState /SMask << /S /Luminosity /G 14 0 R >> >> >> /Pattern << /Tiles 8 0 R >> /Shading << /Dawn 9 0 R >> /XObject << /Swatch 11 0 R >> >> >>",
	)
	pdf.stream(
		4,
		"",
		"BT /F1 18 Tf 20 212 Td (The prism workshop) Tj ET\nq /Cal cs 0.2 0.6 0.8 sc 20 155 45 35 re f /Lab cs 65 35 20 sc 75 155 45 35 re f /Index cs 1 sc 130 155 45 35 re f /Spot cs 0.7 scn 185 155 45 35 re f /Duo cs 0.6 0.3 scn 240 155 45 35 re f /ICC cs 0.5 0.2 0.7 sc 295 155 45 35 re f Q\nq 20 90 150 45 re W n /Dawn sh Q\nq /Pattern cs /Tiles scn 190 90 150 45 re f Q\nq 0.9 0.3 0.1 rg 20 25 60 45 re f /Blend gs 0.1 0.4 0.9 rg 50 40 60 40 re f Q\nq 65 0 0 50 145 25 cm /Swatch Do Q\nq /Mask gs 0.2 0.6 0.4 rg 240 25 90 50 re f Q\n",
		true,
	)
	pdf.add(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
	pdf.add(
		6,
		"<< /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [0.7 0 0.8 0.2] /N 1 >>",
	)
	pdf.stream(
		7,
		"/FunctionType 4 /Domain [0 1 0 1] /Range [0 1 0 1 0 1 0 1]",
		"{ 0 0 }",
	)
	pdf.stream(
		8,
		"/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 8 8] /XStep 8 /YStep 8 /Resources << >>",
		"0.1 0.4 0.5 rg 0 0 4 4 re f 4 4 4 4 re f",
	)
	pdf.add(
		9,
		"<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [20 90 170 135] /Function 10 0 R /Extend [true true] >>",
	)
	pdf.add(
		10,
		"<< /FunctionType 2 /Domain [0 1] /C0 [0.1 0.4 0.7] /C1 [1 0.8 0.3] /N 1 >>",
	)
	pdf.stream(
		11,
		"/Type /XObject /Subtype /Image /Width 2 /Height 2 /BitsPerComponent 8 /ColorSpace /DeviceRGB /SMask 12 0 R /Interpolate false /Intent /RelativeColorimetric",
		Uint8Array.of(255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 180, 0),
		true,
	)
	pdf.stream(
		12,
		"/Type /XObject /Subtype /Image /Width 2 /Height 2 /BitsPerComponent 8 /ColorSpace /DeviceGray",
		Uint8Array.of(255, 180, 90, 20),
		true,
	)
	pdf.stream(
		14,
		"/Type /XObject /Subtype /Form /BBox [0 0 360 240] /Group << /S /Transparency /CS /DeviceGray >> /Resources << >>",
		"0.6 g 240 25 45 50 re f 1 g 285 25 45 50 re f",
	)
	pdf.stream(15, "/N 3 /Alternate /DeviceRGB", gardenProfile(), true)
	pdf.add(
		16,
		"<< /Type /OutputIntent /S /GTS_PDFX /OutputConditionIdentifier (Original Garden RGB) /Info (Synthetic profile; no conformance claim) /DestOutputProfile 15 0 R >>",
	)
	return pdfBytes(pdf.write())
}
