import { deflateSync } from "node:zlib"
import { encryptedPdf, encryptFixtureBytes } from "./encrypted.ts"
import { row } from "./parser.ts"

/** Three revisions exercise lookup caches before and after encryption setup. */
export function encryptedRevisions(vector: number) {
	const { encryption, password } = encryptedPdf({ vector })
	const security = encryption.replace(
		/\/CF << \/StdCF <<[^>]+>> >>/,
		"/CF 5 0 R",
	)
	let source = encryptedPdf({
		vector,
		extraEncryption: security,
		extraObjects: [
			[5, "<< /StdCF 9 0 R >>"],
			[9, "<< /CFM /AESV3 /Description (Historical clear filter) >>"],
			[8, "0000000000"],
		],
	}).source
	const previous = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(source)![1])
	const supplement = source.length
	// Patch a fixed-width integer so all original offsets remain valid.
	const offsetToken = "8 0 obj\n0000000000"
	source = source.replace(
		offsetToken,
		offsetToken.replace("0000000000", String(supplement).padStart(10, "0")),
	)
	const record = Buffer.alloc(7)
	record[0] = 1
	record.writeUInt32BE(supplement, 1)
	source += `14 0 obj\n<< /Type /XRef /Size 15 /Index [14 1] /W [1 4 2] /Length 7 >>\nstream\n${record.toString("latin1")}\nendstream\nendobj\n`
	const trailer =
		"/Root 1 0 R /Info 6 0 R /Encrypt 10 0 R /ID [<000102030405060708090a0b0c0d0e0f> <000102030405060708090a0b0c0d0e0f>]"
	const middle = source.length
	source += `xref\n0 1\n0000000000 65535 f \n14 1\n${row(supplement)}trailer\n<< /Size 15 ${trailer} /Prev ${previous} /XRefStm 8 0 R >>\nstartxref\n${middle}\n%%EOF\n`

	// Replace the warmed lookup object, the crypt filter, and the object stream.
	// Member strings are clear inside the encrypted object stream.
	const compressed = deflateSync("12 0 << /Text (Current compressed member) >>")
	const data = encryptFixtureBytes(compressed)
	const ordinary = encryptFixtureBytes(Buffer.from("Current encrypted value"))
	const updates: [number, string][] = [
		[8, `<${ordinary.toString("hex")}>`],
		[9, "<< /CFM /AESV3 /Description (Current clear filter) >>"],
		[
			11,
			`<< /Type /ObjStm /N 1 /First 5 /Filter /FlateDecode /Length 15 0 R >>\nstream\n${data.toString("latin1")}\nendstream`,
		],
		[15, String(data.length)],
	]
	let rows = ""
	for (const [number, body] of updates) {
		rows += `${number} 1\n${row(source.length)}`
		source += `${number} 0 obj\n${body}\nendobj\n`
	}
	const latest = source.length
	return {
		source:
			source +
			`xref\n${rows}trailer\n<< /Size 16 ${trailer} /Prev ${middle} >>\nstartxref\n${latest}\n%%EOF\n`,
		password,
	}
}
