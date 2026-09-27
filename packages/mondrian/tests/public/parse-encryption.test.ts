import { createCipheriv } from "node:crypto"
import { expect, it } from "vitest"
import {
	parsePdf,
	PdfParseError,
	serializePdf,
	validatePdf,
} from "mondrian.pdf"
import type { PdfParseOptions } from "mondrian.pdf"
import { readPdf } from "mondrian.pdf/testing"

// Fixed Node/OpenSSL password vectors and an independent writer stay with this
// public contract so release replay never depends on today's private fixtures.
// The key, salts, IV, and passwords below are invented test data only.
const vectors = [
	{
		revision: 5,
		password: "reader",
		U: "01aa5473317d53f4582b8a212295179f3346463338bd110339bc8108688c9ba101020304050607081112131415161718",
		O: "93816ecb4e16c23b6a5da3df6771b17f7982a53280fadbebff022ffadca1c5ac21222324252627283132333435363738",
		UE: "c327dfae4b20bd7bcccc047c54b74d5c64ef7284ce71679915e3699ebd30ad86",
		OE: "22c784a3ccdafd8d80ad0817bd3ee060420bf7b71223593142e6c1541cdeb9ce",
	},
	{
		revision: 6,
		password: "",
		U: "8d1efb4f1bdbb651341704c2139de4f6be05d6d4609af56916b21646ed74825c01020304050607081112131415161718",
		O: "1e176cecca2994e8557a48a44c9cc18d1e3a48631f0366cac8941b897275d9c421222324252627283132333435363738",
		UE: "53a40bb1755088bbbde7481347dff2f2122f97663fbca9c94a9b8b1d45409550",
		OE: "a9bd1946f38f5bb2c64ac7c4a1e89077314ea89cc4789306512ec91d2a18d07a",
	},
	{
		revision: 6,
		password: "café",
		U: "cd41c02ea3249c6344a6cb75bc96ec3988f775b70fe7caa6097f5dcbdce1a5e101020304050607081112131415161718",
		O: "87358c03dae7cddbc73bc5e9f1db3b20c4adcf7a254bec590dc00082c93c5b0421222324252627283132333435363738",
		UE: "cf6986a9ba281c8721ba34bf1838073a9d420058fadaa8fa213a4565947cabc8",
		OE: "f71ae59b7344d41aa09b73744d65c4513f978f1af141893f59fe5db079c85be3",
	},
]

it.each(vectors)(
	"opens AES-256 revision $revision with user/owner passwords and writes readable unencrypted output ($password)",
	async (vector) => {
		const source = encryptedTextPdf(vector)
		const user: PdfParseOptions =
			vector.password === ""
				? {}
				: {
						password:
							vector.password === "café"
								? new TextEncoder().encode(vector.password)
								: vector.password,
					}
		for (const options of [user, { password: "owner" }]) {
			const document = parsePdf(source, options)
			expect(
				validatePdf(document).filter(
					(diagnostic) => diagnostic.severity === "error",
				),
			).toEqual([])
			const output = serializePdf(document)
			// PDFium is opened without a password and therefore proves decryption
			// independently of a second call to our parser.
			const read = await readPdf(output)
			expect(read.title).toBe("Password contract")
			expect(read.pages).toEqual([
				{
					width: 144,
					height: 216,
					rotation: 0,
					text: "Opened with a password",
				},
			])
			const reparsed = parsePdf(output)
			expect((await readPdf(serializePdf(reparsed))).pages).toEqual(read.pages)
		}
		expect(() => parsePdf(source, { password: "incorrect" })).toThrow(
			PdfParseError,
		)
	},
)

function encryptedTextPdf(vector: (typeof vectors)[number]): string {
	const key = Buffer.from(Array.from({ length: 32 }, (_, index) => index))
	const encrypt = (text: string): Buffer => {
		const iv = Buffer.alloc(16, 0x42)
		const cipher = createCipheriv("aes-256-cbc", key, iv)
		return Buffer.concat([iv, cipher.update(text, "ascii"), cipher.final()])
	}
	const cipher = createCipheriv("aes-256-ecb", key, null)
	cipher.setAutoPadding(false)
	const permissions = Buffer.concat([
		cipher.update(Buffer.from("fcffffffffffffff5461646201020304", "hex")),
		cipher.final(),
	]).toString("hex")
	const content = encrypt(
		"BT /F1 12 Tf 20 100 Td (Opened with a password) Tj ET",
	)
	const bodies = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 144 216] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
		`<< /Length ${content.length} >>\nstream\n${content.toString("latin1")}\nendstream`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		`<< /Title <${encrypt("Password contract").toString("hex")}> >>`,
		`<< /Filter /Standard /V 5 /R ${vector.revision} /Length 256 /P -4 /EncryptMetadata true /U <${vector.U}> /O <${vector.O}> /UE <${vector.UE}> /OE <${vector.OE}> /Perms <${permissions}> /CF << /StdCF << /CFM /AESV3 /Length 32 /AuthEvent /DocOpen >> >> /StrF /StdCF /StmF /StdCF >>`,
	]
	let source = "%PDF-1.7\n"
	const offsets: number[] = []
	for (const [index, body] of bodies.entries()) {
		offsets.push(source.length)
		source += `${index + 1} 0 obj\n${body}\nendobj\n`
	}
	const xref = source.length
	const rows = offsets
		.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
		.join("")
	return (
		source +
		`xref\n0 8\n0000000000 65535 f \n${rows}trailer\n<< /Size 8 /Root 1 0 R /Info 6 0 R /Encrypt 7 0 R /ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>] >>\nstartxref\n${xref}\n%%EOF\n`
	)
}
