// SPDX-License-Identifier: MPL-2.0
import { WirePdf, pdfBytes } from "../original-corpus/wire.ts"

export const scalePageCount = 420
export const scalePayloadBytes = 31 * 1024 * 1024
export const scaleOutlineDepth = 64
export const scaleOutlineCount = 21 + scalePageCount + scaleOutlineDepth - 1
export const scaleObjectCount = 6 + 21 + scalePageCount * 8 + scaleOutlineCount

export function originalPayload(): Uint8Array {
	const bytes = new Uint8Array(scalePayloadBytes)
	let state = 0x4d4f4f4e
	for (let index = 0; index < bytes.length; index++) {
		state ^= state << 13
		state ^= state >>> 17
		state ^= state << 5
		bytes[index] = state & 255
	}
	// These are binary payload bytes, not PDF delimiters. Stream Length must win.
	bytes.set(
		Buffer.from(
			"\r\nendstream\r\nendobj\r\nxref\r\n%PDF-2.0\r\nstartxref\r\n0\r\n%%EOF\r\n",
		),
		1024 * 1024,
	)
	return bytes
}

export function scaleRepresentative(variant: 0 | 1): Uint8Array {
	return buildScale({ pages: 1, variant, payload: false, outlines: false })
}

export function scaleDocument(): Uint8Array {
	return buildScale({ pages: scalePageCount, payload: true, outlines: true })
}

function buildScale(options: {
	pages: number
	variant?: 0 | 1
	payload: boolean
	outlines: boolean
}): Uint8Array {
	const pdf = new WirePdf("1.7")
	const sections = Math.ceil(options.pages / 20)
	pdf.add(
		1,
		`<< /Type /Catalog /Pages 2 0 R ${options.payload ? "/Names << /EmbeddedFiles << /Names [(field-data.bin) 3 0 R] >> >>" : ""} ${options.outlines ? "/Outlines 5 0 R" : ""} >>`,
	)
	pdf.add(
		2,
		`<< /Type /Pages /Count ${options.pages} /Kids [${Array.from({ length: sections }, (_, section) => `${20 + section} 0 R`).join(" ")}] >>`,
	)
	if (options.payload) {
		pdf.add(
			3,
			"<< /Type /Filespec /F (field-data.bin) /Desc (Original deterministic sensor data) /EF << /F 4 0 R >> >>",
		)
		pdf.stream(
			4,
			`/Type /EmbeddedFile /Subtype /application#2Foctet-stream /Params << /Size ${scalePayloadBytes} >>`,
			originalPayload(),
		)
	}
	pdf.add(
		6,
		"<< /Title (The very long imaginary field ledger) /Author (Original fixture office) /CreationDate (D:20260901120000Z) >>",
	)
	for (let section = 0; section < sections; section++) {
		const count = Math.min(20, options.pages - section * 20)
		pdf.add(
			20 + section,
			`<< /Type /Pages /Parent 2 0 R /Count ${count} /Kids [${Array.from({ length: count }, (_, index) => `${100 + (section * 20 + index) * 8} 0 R`).join(" ")}] >>`,
		)
	}
	for (let index = 0; index < options.pages; index++) {
		const first = 100 + index * 8,
			parent = 20 + Math.floor(index / 20)
		const variant = options.variant ?? index % 2
		const label = variant ? "Southern ledger" : "Northern ledger"
		pdf.add(
			first,
			`<< /Type /Page /Parent ${parent} 0 R /MediaBox [0 0 240 180] /Resources ${first + 4} 0 R /Contents ${first + 1} 0 R /Annots [${first + 6} 0 R] /Metadata ${first + 7} 0 R >>`,
		)
		pdf.add(first + 1, `[${first + 2} 0 R ${first + 3} 0 R]`)
		pdf.stream(
			first + 2,
			"",
			`BT /F1 18 Tf 18 147 Td (${label}) Tj ET\nBT /F1 10 Tf 18 126 Td (An invented repeatable field record.) Tj ET\nBT /F1 10 Tf 18 109 Td (Shared appearance; independent objects.) Tj ET\n`,
			true,
		)
		pdf.stream(
			first + 3,
			"",
			`q ${variant ? "0.55 0.25 0.45" : "0.15 0.55 0.65"} rg 18 30 204 ${variant ? 45 : 60} re f Q\n`,
		)
		pdf.add(first + 4, `<< /Font << /F1 ${first + 5} 0 R >> >>`)
		pdf.add(first + 5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
		pdf.add(
			first + 6,
			`<< /Type /Annot /Subtype /Link /Rect [18 10 220 25] /Border [0 0 0] /Dest [${100 + ((index + 1) % options.pages) * 8} 0 R /Fit] >>`,
		)
		pdf.stream(
			first + 7,
			"/Type /Metadata /Subtype /XML",
			`<record xmlns="urn:mondrian:original-fixture" number="${index + 1}" section="${Math.floor(index / 20) + 1}"/>`,
		)
	}
	if (options.outlines) {
		pdf.add(
			5,
			`<< /Type /Outlines /First 4000 0 R /Last 4420 0 R /Count ${scaleOutlineCount} >>`,
		)
		for (let chapter = 0; chapter < 21; chapter++) {
			const first = 4000 + chapter * 21
			pdf.add(
				first,
				`<< /Title (Field volume ${chapter + 1}) /Parent 5 0 R /First ${first + 1} 0 R /Last ${chapter === 20 ? 4500 : first + 20} 0 R /Count ${20 + (chapter === 20 ? scaleOutlineDepth - 1 : 0)} /Dest [${100 + chapter * 20 * 8} 0 R /Fit] ${chapter ? `/Prev ${first - 21} 0 R` : ""} ${chapter < 20 ? `/Next ${first + 21} 0 R` : ""} >>`,
			)
			for (let leaf = 0; leaf < 20; leaf++) {
				const number = first + leaf + 1
				pdf.add(
					number,
					`<< /Title (Record ${chapter * 20 + leaf + 1}) /Parent ${first} 0 R /Dest [${100 + (chapter * 20 + leaf) * 8} 0 R /Fit] ${leaf ? `/Prev ${number - 1} 0 R` : ""} ${leaf < 19 ? `/Next ${number + 1} 0 R` : chapter === 20 ? "/Next 4500 0 R" : ""} >>`,
				)
			}
		}
		for (let depth = 0; depth < scaleOutlineDepth - 1; depth++) {
			const number = 4500 + depth,
				descendants = scaleOutlineDepth - depth - 2
			pdf.add(
				number,
				`<< /Title (Nested appendix ${depth + 1}) /Parent ${depth ? number - 1 : 4420} 0 R /Dest [${100 + (scalePageCount - 1) * 8} 0 R /Fit] ${depth === 0 ? "/Prev 4440 0 R" : ""} ${descendants ? `/First ${number + 1} 0 R /Last ${number + 1} 0 R /Count ${descendants}` : ""} >>`,
			)
		}
	}
	return pdfBytes(pdf.write({ trailer: "/Info 6 0 R" }))
}
