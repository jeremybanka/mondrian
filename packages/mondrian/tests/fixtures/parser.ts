import { deflateSync } from "node:zlib"
import { binaryText } from "../../src/parser/syntax.ts"

export function row(offset: number, generation = 0): string {
	return `${String(offset).padStart(10, "0")} ${String(generation).padStart(5, "0")} n \n`
}

export function classic(
	objects: [number, number, string][],
	trailer: string,
): string {
	let source = "%PDF-1.7\n"
	let rows = "0 1\n0000000000 65535 f \n"
	for (const [number, generation, body] of objects) {
		rows += `${number} 1\n${row(source.length, generation)}`
		source += `${number} ${generation} obj\n${body}\nendobj\n`
	}
	return (
		source +
		`xref\n${rows}trailer\n<< /Size ${Math.max(...objects.map(([number]) => number)) + 1} ${trailer} >>\nstartxref\n${source.length}\n%%EOF\n`
	)
}

export function structuralPdf(options: {
	hybrid?: boolean
	predicted?: boolean
	indirectType?: boolean
	indirectOffset?: boolean
}): string {
	let source = "%PDF-1.7\n"
	const offsets = new Map<number, number>()
	const add = (number: number, body: string) => {
		offsets.set(number, source.length)
		source += `${number} 0 obj\n${body}\nendobj\n`
	}
	add(1, "<< /Type /Catalog /Pages 2 0 R /Extra 4 0 R >>")
	add(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
	add(
		3,
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> >>",
	)
	if (options.indirectType) add(7, "/ObjStm")
	const offsetNumber = options.indirectType ? 8 : 7
	if (options.indirectOffset) add(offsetNumber, "0000000000")
	const count =
		7 + Number(!!options.indirectType) + Number(!!options.indirectOffset)
	const objects = "4 0 << /Answer 42 >>"
	const compressed = binaryText(deflateSync(objects))
	add(
		5,
		`<< /Type ${options.indirectType ? "7 0 R" : "/ObjStm"} /N 1 /First 4 /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n${compressed}\nendstream`,
	)
	offsets.set(6, source.length)
	const records = new Uint8Array(count * 7)
	const view = new DataView(records.buffer)
	for (let number = 0; number < count; number++) {
		const position = number * 7
		records[position] = number === 0 ? 0 : number === 4 ? 2 : 1
		view.setUint32(position + 1, number === 4 ? 5 : (offsets.get(number) ?? 0))
		view.setUint16(position + 5, number === 0 ? 65535 : 0)
	}
	let data = records
	let filters = ""
	if (options.predicted) {
		const predicted = new Uint8Array(count * 8)
		for (let row = 0; row < count; row++) {
			predicted[row * 8] = 2
			for (let byte = 0; byte < 7; byte++)
				predicted[row * 8 + byte + 1] =
					records[row * 7 + byte]! -
					(row === 0 ? 0 : records[(row - 1) * 7 + byte]!)
		}
		data = Uint8Array.from(deflateSync(predicted))
		filters = "/Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 7 >>"
	}
	add(
		6,
		`<< /Type /XRef /Size ${count} /Root 1 0 R /W [1 4 2] /Index [0 ${count}] ${filters} /Length ${data.length} >>\nstream\n${binaryText(data)}\nendstream`,
	)
	let xref = offsets.get(6)!
	if (options.hybrid) {
		xref = source.length
		source += `xref\n0 ${count}\n0000000000 65535 f \n`
		for (let number = 1; number < count; number++)
			source +=
				number === 4 ? "0000000000 00000 f \n" : row(offsets.get(number)!)
		source += `trailer\n<< /Size ${count} /Root 1 0 R /XRefStm ${options.indirectOffset ? `${offsetNumber} 0 R` : offsets.get(6)} >>\n`
	}
	if (options.indirectOffset)
		source = source.replace(
			`${offsetNumber} 0 obj\n0000000000`,
			`${offsetNumber} 0 obj\n${String(offsets.get(6)).padStart(10, "0")}`,
		)
	return source + `startxref\n${xref}\n%%EOF\n`
}
