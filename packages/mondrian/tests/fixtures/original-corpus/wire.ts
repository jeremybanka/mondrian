// SPDX-License-Identifier: MPL-2.0
import { deflateSync } from "node:zlib"

/** Independent fixture writer: deliberately does not use Mondrian serialization. */
export class WirePdf {
	readonly objects = new Map<number, string>()
	readonly version: string
	constructor(version = "1.7") {
		this.version = version
	}
	add(number: number, body: string): this {
		if (this.objects.has(number))
			throw new Error(`Duplicate fixture object ${number}`)
		this.objects.set(number, body)
		return this
	}
	stream(
		number: number,
		entries: string,
		bytes: string | Uint8Array,
		flate = false,
	): this {
		const data = flate
			? deflateSync(bytes)
			: typeof bytes === "string"
				? Buffer.from(bytes, "latin1")
				: bytes
		return this.add(
			number,
			`<< ${entries} ${flate ? "/Filter /FlateDecode" : ""} /Length ${data.length} >>\nstream\n${Buffer.from(data).toString("latin1")}\nendstream`,
		)
	}
	write(
		options: {
			trailer?: string
			compressed?: number[]
			hybrid?: boolean
			zeroOffset?: number
		} = {},
	): string {
		const compressed = options.compressed ?? []
		const bodies = new Map(this.objects)
		const objectStream = Math.max(...bodies.keys(), options.zeroOffset ?? 0) + 1
		const xrefStream = objectStream + 1
		const size = compressed.length ? xrefStream + 1 : objectStream
		if (compressed.length) {
			let header = "",
				contents = ""
			for (const number of compressed) {
				const body = bodies.get(number)
				if (body === undefined || body.includes("\nstream\n"))
					throw new Error("Invalid compressed fixture object")
				header += `${number} ${contents.length} `
				contents += `${body}\n`
				bodies.delete(number)
			}
			const data = deflateSync(header + contents)
			bodies.set(
				objectStream,
				`<< /Type /ObjStm /N ${compressed.length} /First ${header.length} /Filter /FlateDecode /Length ${data.length} >>\nstream\n${data.toString("latin1")}\nendstream`,
			)
		}
		let source = `%PDF-${this.version}\n%\x80\x81\x82\x83\n`
		const offsets = new Map<number, number>()
		const add = (number: number, body: string) => {
			offsets.set(number, source.length)
			source += `${number} 0 obj\n${body}\nendobj\n`
		}
		for (const [number, body] of bodies) add(number, body)
		const trailer = `/Size ${size} /Root 1 0 R /ID [<01020304050607080910111213141516> <01020304050607080910111213141516>] ${options.trailer ?? ""}`
		let startxref = source.length
		if (compressed.length) {
			offsets.set(xrefStream, startxref)
			const rows = Buffer.alloc(size * 7)
			for (let number = 0; number < size; number++) {
				const index = compressed.indexOf(number)
				rows[number * 7] = index >= 0 ? 2 : offsets.has(number) ? 1 : 0
				rows.writeUInt32BE(
					index >= 0 ? objectStream : (offsets.get(number) ?? 0),
					number * 7 + 1,
				)
				rows.writeUInt16BE(
					index >= 0 ? index : number === 0 ? 65535 : 0,
					number * 7 + 5,
				)
			}
			// PNG Up prediction exercises structural decoding independently of image filters.
			const predicted = Buffer.alloc(size * 8)
			for (let line = 0; line < size; line++) {
				predicted[line * 8] = 2
				for (let column = 0; column < 7; column++)
					predicted[line * 8 + column + 1] =
						(rows[line * 7 + column]! -
							(line ? rows[(line - 1) * 7 + column]! : 0)) &
						255
			}
			const data = deflateSync(predicted)
			add(
				xrefStream,
				`<< /Type /XRef ${trailer} /W [1 4 2] /Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 7 >> /Length ${data.length} >>\nstream\n${data.toString("latin1")}\nendstream`,
			)
		}
		if (!compressed.length || options.hybrid) {
			startxref = source.length
			source += `xref\n0 ${size}\n0000000000 65535 f \n`
			for (let number = 1; number < size; number++) {
				const offset = offsets.get(number)
				source +=
					offset !== undefined || number === options.zeroOffset
						? `${String(offset ?? 0).padStart(10, "0")} 00000 n \n`
						: "0000000000 00000 f \n"
			}
			source += `trailer\n<< ${trailer} ${options.hybrid ? `/XRefStm ${offsets.get(xrefStream)}` : ""} >>\n`
		}
		return `${source}startxref\n${startxref}\n%%EOF\n`
	}
}

export const pdfBytes = (source: string) =>
	Uint8Array.from(Buffer.from(source, "latin1"))
export const hexUtf8 = (text: string) =>
	`<efbbbf${Buffer.from(text).toString("hex")}>`
export const hexUtf16 = (text: string) =>
	`<feff${Buffer.from(text, "utf16le").swap16().toString("hex")}>`

export function appendRevision(source: string, catalog: string): string {
	const previous = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(source)![1]!
	const offset = source.length
	const revised = `${source}1 0 obj\n${catalog}\nendobj\n`
	return `${revised}xref\n1 1\n${String(offset).padStart(10, "0")} 00000 n \ntrailer\n<< /Size 10 /Root 1 0 R /ID [<01020304050607080910111213141516> <01020304050607080910111213141516>] /Prev ${previous} >>\nstartxref\n${revised.length}\n%%EOF\n`
}

export function ascii85(bytes: Uint8Array): string {
	let output = ""
	for (let start = 0; start < bytes.length; start += 4) {
		const length = Math.min(4, bytes.length - start)
		let word = 0
		for (let index = 0; index < 4; index++)
			word = word * 256 + (bytes[start + index] ?? 0)
		const digits = Array<number>(5)
		for (let index = 4; index >= 0; index--) {
			digits[index] = (word % 85) + 33
			word = Math.floor(word / 85)
		}
		output += String.fromCharCode(...digits.slice(0, length + 1))
	}
	return output + "~>"
}
