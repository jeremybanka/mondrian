import { createCipheriv } from "node:crypto"
import { deflateSync } from "node:zlib"
import vectors from "./encryption-vectors.json" with { type: "json" }
import { row } from "./parser.ts"

// Fixed, independently calculated password vectors use Node/OpenSSL, not the
// parser's crypto implementation. The file key, salts and IVs are test data only.
export const fileKey = Buffer.from(Array.from({ length: 32 }, (_, i) => i))
export const plainContent = "q 0.2 0.4 0.8 rg 5 5 20 20 re f Q\n"
export const plainMetadata = '<x:xmpmeta xmlns:x="adobe:ns:meta/"/>'
export function encryptedPdf(
	options: {
		vector?: number
		compressed?: boolean
		metadata?: boolean
		strings?: boolean
		streams?: boolean
		permissionBytes?: Buffer
		extraEncryption?: string
		contentData?: Buffer
		streamEntries?: string
		embedded?: boolean
		signatureType?: string
		extraObjects?: [number, string][]
		directInfo?: boolean
	} = {},
) {
	const vector = vectors[options.vector ?? 1]!
	const compressed = options.compressed !== false
	const metadata = options.metadata !== false
	const strings = options.strings !== false
	const streams = options.streams !== false
	const encrypt = (bytes: Buffer) => {
		const iv = Buffer.alloc(16, 0x42)
		const aes = createCipheriv("aes-256-cbc", fileKey, iv)
		return Buffer.concat([iv, aes.update(bytes), aes.final()])
	}
	const text = (value: string) =>
		`<${(strings ? encrypt(Buffer.from(value)) : Buffer.from(value)).toString("hex")}>`
	const literal = (value: string) =>
		"(" +
		[...(strings ? encrypt(Buffer.from(value)) : Buffer.from(value))]
			.map((byte) => "\\" + byte.toString(8).padStart(3, "0"))
			.join("") +
		")"
	const perms =
		options.permissionBytes ??
		Buffer.from("fcffffffffffffff5461646201020304", "hex")
	if (!metadata && options.permissionBytes === undefined) perms[8] = 0x46
	const permCipher = createCipheriv("aes-256-ecb", fileKey, null)
	permCipher.setAutoPadding(false)
	const encryptedPerms = Buffer.concat([
		permCipher.update(perms),
		permCipher.final(),
	])
	const encryption = `/Filter /Standard /V 5 /R ${vector.revision} /Length 256 /P -4 /EncryptMetadata ${metadata} /O <${vector.O}> /U <${vector.U}> /OE <${vector.OE}> /UE <${vector.UE}> /Perms <${encryptedPerms.toString("hex")}> /CF << /StdCF << /CFM /AESV3 /Length 32 /AuthEvent /DocOpen >> >> /StrF /${strings ? "StdCF" : "Identity"} /StmF /${streams ? "StdCF" : "Identity"}`
	let source = options.directInfo ? "%PDF-2.0\n" : "%PDF-1.7\n"
	const offsets = new Map<number, number>()
	const add = (number: number, body: string) => {
		offsets.set(number, source.length)
		source += `${number} 0 obj\n${body}\nendobj\n`
	}
	const stream = (number: number, entries: string, data: Buffer) =>
		add(
			number,
			`<< ${entries} /Length ${data.length} >>\nstream\n${data.toString("latin1")}\nendstream`,
		)
	add(
		1,
		"<< /Type /Catalog /Pages 2 0 R /Extra 5 0 R /Metadata 7 0 R /Compressed 12 0 R /Signature 9 0 R >>",
	)
	add(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
	add(
		3,
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 40 40] /Resources << >> /Contents 4 0 R >>",
	)
	const data = deflateSync(plainContent)
	stream(
		4,
		options.streamEntries ?? "/Filter /FlateDecode",
		options.contentData ?? (streams ? encrypt(data) : data),
	)
	add(
		5,
		`<< /Text ${text("Nested text")} /Items [${literal("Literal text")}] /#ff ${text("Byte key")} >>`,
	)
	// Strings in cross-reference stream dictionaries are never encrypted.
	const infoText =
		options.directInfo && compressed
			? (value: string) => `<${Buffer.from(value).toString("hex")}>`
			: text
	const info = `<< /Title ${infoText("Encrypted fixture")} /CreationDate ${infoText("D:20260926120000Z")} >>`
	if (!options.directInfo) add(6, info)
	const meta = Buffer.from(plainMetadata)
	stream(
		7,
		`/Type /${options.embedded ? "EmbeddedFile" : "Metadata"} /Subtype /XML`,
		options.embedded || (streams && metadata) ? encrypt(meta) : meta,
	)
	add(9, `<< /Type /${options.signatureType ?? "Sig"} /Contents <01020304> >>`)
	add(10, `<< ${options.extraEncryption ?? encryption} >>`)
	if (compressed) {
		const objects = deflateSync("12 0 << /Text (Inside object stream) >>")
		stream(
			11,
			"/Type /ObjStm /N 1 /First 5 /Filter /FlateDecode",
			streams ? encrypt(objects) : objects,
		)
	} else add(12, `<< /Text ${text("Inside object stream")} >>`)
	for (const [number, body] of options.extraObjects ?? []) add(number, body)
	const startxref = source.length
	const trailer = `/Size 14 /Root 1 0 R /Info ${options.directInfo ? info : "6 0 R"} /Encrypt 10 0 R /ID [<000102030405060708090a0b0c0d0e0f> <000102030405060708090a0b0c0d0e0f>]`
	if (compressed) {
		offsets.set(13, startxref)
		const bytes = Buffer.alloc(14 * 7)
		for (let number = 0; number < 14; number++) {
			const type = number === 12 ? 2 : offsets.has(number) ? 1 : 0
			bytes[number * 7] = type
			bytes.writeUInt32BE(
				type === 2 ? 11 : (offsets.get(number) ?? 0),
				number * 7 + 1,
			)
			bytes.writeUInt16BE(number === 0 ? 65535 : 0, number * 7 + 5)
		}
		stream(13, `/Type /XRef /W [1 4 2] ${trailer}`, bytes)
	} else {
		source += "xref\n0 14\n0000000000 65535 f \n"
		for (let number = 1; number < 14; number++)
			source += offsets.has(number)
				? row(offsets.get(number)!)
				: "0000000000 00000 f \n"
		source += `trailer\n<< ${trailer} >>\n`
	}
	return {
		source: source + `startxref\n${startxref}\n%%EOF\n`,
		encryption,
		password: vector.password,
	}
}
