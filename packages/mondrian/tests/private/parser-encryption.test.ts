import { expect, it } from "vitest"
import {
	parsePdf,
	PdfParseError,
	serializePdf,
	validatePdf,
} from "../../src/index.ts"
import {
	encryptedPdf,
	encryptFixtureBytes,
	plainContent,
	plainMetadata,
} from "../fixtures/encrypted.ts"
import { deflateSync, inflateSync } from "node:zlib"
import { isDeepStrictEqual } from "node:util"
import { provePages } from "../fixtures/original-corpus/proof.ts"

it.each([0, 1, 2])(
	"decrypts AES-256 password vector %s and compressed objects",
	(vector) => {
		const { source, password } = encryptedPdf({ vector })
		const document = parsePdf(source, { password: Buffer.from(password) })
		expect(validatePdf(document).filter((d) => d.severity === "error")).toEqual(
			[],
		)
		expect(
			document.objects.some(
				(o) => o.objectNumber === 10 || o.objectNumber === 13,
			),
		).toBe(false)
		expect(
			document.objects.find((o) => o.objectNumber === 6)?.value,
		).toMatchObject({
			entries: {
				Title: { bytes: new TextEncoder().encode("Encrypted fixture") },
			},
		})
		expect(
			document.objects.find((o) => o.objectNumber === 12)?.value,
		).toMatchObject({
			entries: {
				Text: { bytes: new TextEncoder().encode("Inside object stream") },
			},
		})
		expect(
			document.objects.find((o) => o.objectNumber === 5)?.value,
		).toMatchObject({
			entries: {
				Text: { bytes: new TextEncoder().encode("Nested text") },
				Items: { items: [{ bytes: new TextEncoder().encode("Literal text") }] },
			},
			byteEntries: [
				[
					expect.anything(),
					{ kind: "hex-string", bytes: new TextEncoder().encode("Byte key") },
				],
			],
		})
		const contents = document.objects.find((o) => o.objectNumber === 4)!.value
		if (contents && typeof contents === "object" && contents.kind === "stream")
			expect(inflateSync(contents.data).toString()).toBe(plainContent)
		else throw new Error("Missing content stream")
		expect(
			document.objects.find((o) => o.objectNumber === 9)?.value,
		).toMatchObject({
			entries: { Contents: { bytes: Uint8Array.of(1, 2, 3, 4) } },
		})
		const serialized = serializePdf(document)
		expect(isDeepStrictEqual(parsePdf(serialized), document)).toBe(true)
		expect(serializePdf(parsePdf(serialized))).toEqual(serialized)
	},
)

it.each([0, 1, 2])("accepts the owner password for vector %s", (vector) => {
	expect(() =>
		parsePdf(encryptedPdf({ vector }).source, { password: "owner" }),
	).not.toThrow()
})

it("opens empty-password files by default and diagnoses incorrect passwords", () => {
	expect(() => parsePdf(encryptedPdf().source)).not.toThrow()
	expect(() => parsePdf(encryptedPdf().source, { password: "wrong" })).toThrow(
		/password/,
	)
	expect(() => parsePdf(encryptedPdf({ vector: 0 }).source)).toThrow(/password/)
	expect(() => parsePdf(encryptedPdf().source, { password: "café" })).toThrow(
		/prepared UTF-8/,
	)
})

it.each([
	{ metadata: false },
	{ strings: false },
	{ streams: false },
	{ compressed: false },
])(
	"honors metadata and Identity filters with classic or streamed xrefs (%j)",
	(options) => {
		const document = parsePdf(encryptedPdf(options).source)
		expect(
			document.objects.find((o) => o.objectNumber === 7)?.value,
		).toMatchObject({ data: new TextEncoder().encode(plainMetadata) })
		expect(parsePdf(serializePdf(document))).toEqual(document)
	},
)

it("rejects tampered permissions and malformed encrypted data", () => {
	const permissionBytes = Buffer.from("fcffffffffffffff5461646201020304", "hex")
	permissionBytes[0] = 0
	expect(() => parsePdf(encryptedPdf({ permissionBytes }).source)).toThrow(
		/permissions/,
	)
	expect(() =>
		parsePdf(encryptedPdf({ contentData: Buffer.alloc(16) }).source),
	).toThrow(/encrypted data/)
	expect(() =>
		parsePdf(encryptedPdf({ contentData: Buffer.alloc(32) }).source),
	).toThrow(/encrypted data/)
})

it.each([
	["/Filter /Standard", "/Filter /Custom"],
	["/R 6", "/R 4"],
	["/V 5", "/V 4"],
	["/Length 256", "/Length 128"],
	["/CFM /AESV3", "/CFM /AESV2"],
])("rejects unsupported encryption dictionaries (%s)", (from, to) => {
	const { encryption } = encryptedPdf()
	expect(() =>
		parsePdf(
			encryptedPdf({ extraEncryption: encryption.replace(from, to) }).source,
		),
	).toThrow(PdfParseError)
})

it.each([
	[/\/U <[^>]+>/, "/U <00>"],
	[/\/OE <[^>]+>/, "/OE 42"],
	[/\/Perms <[^>]+>/, "/Perms null"],
	[/\/EncryptMetadata true/, "/EncryptMetadata 42"],
	[/\/P -4/, "/P -2147483649"],
	[/\/P -4/, "/P 2147483648"],
	[/\/P -4/, "/P 0.5"],
	[/\/StrF \/StdCF/, "/StrF 42"],
	[/\/StrF \/StdCF/, "/StrF /Missing"],
	[/\/CF << \/StdCF <<[^>]+>> >>/, "/CF null"],
	[/\/Length 32/, "/Length 16"],
])("rejects malformed security parameters (%#)", (pattern, replacement) => {
	const { encryption } = encryptedPdf()
	expect(encryption).toMatch(pattern)
	expect(() =>
		parsePdf(
			encryptedPdf({
				extraEncryption: encryption.replace(pattern, replacement),
			}).source,
		),
	).toThrow(PdfParseError)
})

it.each(["/CFM /None", ""])("honors cleartext crypt filters %s", (method) => {
	const options = { strings: false, streams: false }
	const { encryption } = encryptedPdf(options)
	const extraEncryption = encryption
		.replaceAll("/Identity", "/StdCF")
		.replace("/CFM /AESV3", method)
	const doc = parsePdf(encryptedPdf({ ...options, extraEncryption }).source)
	expect(parsePdf(serializePdf(doc))).toEqual(doc)
})

it("defaults omitted stream and string filters to Identity", () => {
	const options = { strings: false, streams: false }
	const { encryption } = encryptedPdf(options)
	const extraEncryption = encryption.replace(
		"/StrF /Identity /StmF /Identity",
		"",
	)
	const doc = parsePdf(encryptedPdf({ ...options, extraEncryption }).source)
	expect(parsePdf(serializePdf(doc))).toEqual(doc)
})

it("uses the embedded-file crypt filter separately from the stream filter", () => {
	const options = { streams: false, embedded: true }
	const { encryption } = encryptedPdf(options)
	const doc = parsePdf(
		encryptedPdf({ ...options, extraEncryption: encryption + " /EFF /StdCF" })
			.source,
	)
	expect(doc.objects.find((o) => o.objectNumber === 7)?.value).toMatchObject({
		data: new TextEncoder().encode(plainMetadata),
	})
})

it.each(["", " /EFF null"])(
	"inherits the stream crypt filter for absent or null EFF (%j)",
	(eff) => {
		const { encryption } = encryptedPdf()
		const document = parsePdf(
			encryptedPdf({ embedded: true, extraEncryption: encryption + eff })
				.source,
		)
		for (const result of [document, parsePdf(serializePdf(document))])
			expect(
				result.objects.find((o) => o.objectNumber === 7)?.value,
			).toMatchObject({
				data: new TextEncoder().encode(plainMetadata),
			})
	},
)

it("does not decrypt document timestamp signature Contents", () => {
	const doc = parsePdf(encryptedPdf({ signatureType: "DocTimeStamp" }).source)
	expect(doc.objects.find((o) => o.objectNumber === 9)?.value).toMatchObject({
		entries: { Contents: { bytes: Uint8Array.of(1, 2, 3, 4) } },
	})
})

it.each(["", "/Type null"])(
	"preserves signature Contents without an explicit Type (%j)",
	async (type) => {
		const reason = encryptFixtureBytes(Buffer.from("Original receipt"))
		const { source } = encryptedPdf({
			extraObjects: [
				[
					9,
					`<< ${type} /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange [0 10 20 30] /Contents <01020304> /Reason <${reason.toString("hex")}> >>`,
				],
			],
		})
		const expectedPages = await provePages(Buffer.from(source, "latin1"))
		const document = parsePdf(source)
		for (const result of [document, parsePdf(serializePdf(document))])
			expect(
				result.objects.find((o) => o.objectNumber === 9)?.value,
			).toMatchObject({
				entries: {
					Contents: { bytes: Uint8Array.of(1, 2, 3, 4) },
					Reason: { bytes: new TextEncoder().encode("Original receipt") },
				},
			})
		expect(await provePages(serializePdf(document))).toEqual(expectedPages)
	},
)

it.each(["", "/Type /Annot /ByteRange [0 10 20 30]"])(
	"still decrypts ordinary Contents strings (%j)",
	(entries) => {
		const contents = encryptFixtureBytes(Buffer.from("Ordinary content"))
		const document = parsePdf(
			encryptedPdf({
				extraObjects: [
					[8, `<< ${entries} /Contents <${contents.toString("hex")}> >>`],
				],
			}).source,
		)
		expect(
			document.objects.find((o) => o.objectNumber === 8)?.value,
		).toMatchObject({
			entries: {
				Contents: { bytes: new TextEncoder().encode("Ordinary content") },
			},
		})
	},
)

it("rejects explicit Crypt filters instead of applying the wrong decryption", () => {
	for (const streamEntries of [
		"/Filter /Crypt",
		"/Filter [/Crypt /FlateDecode]",
	])
		expect(() => parsePdf(encryptedPdf({ streamEntries }).source)).toThrow(
			/Explicit Crypt/,
		)
})

it("charges decrypted structural bytes as well as inflated bytes to the budget", () => {
	const source = encryptedPdf().source
	const objectStream = "12 0 << /Text (Inside object stream) >>"
	const total = 14 * 7 + deflateSync(objectStream).length + objectStream.length
	expect(() => parsePdf(source, { maxTotalDecodedBytes: total })).not.toThrow()
	expect(() => parsePdf(source, { maxTotalDecodedBytes: total - 1 })).toThrow(
		/decoded-byte limit/,
	)
	expect(() => parsePdf(source, { maxTotalDecodedBytes: 14 * 7 })).toThrow(
		/decoded-byte limit/,
	)
})

it("rejects invalid password values without coercing them", () => {
	expect(() =>
		parsePdf(encryptedPdf().source, { password: 42 as never }),
	).toThrow(/password string/)
	expect(() => parsePdf(encryptedPdf().source, { password: "\u0000" })).toThrow(
		/prepared UTF-8/,
	)
})

it("keeps indirect crypt-filter dictionaries outside object decryption", () => {
	const { encryption } = encryptedPdf()
	const extraEncryption = encryption.replace(
		/\/CF << \/StdCF <<[^>]+>> >>/,
		"/CF 8 0 R",
	)
	const document = parsePdf(
		encryptedPdf({
			extraEncryption,
			extraObjects: [
				[
					8,
					"<< /StdCF << /CFM /AESV3 /Description (Clear configuration) >> >>",
				],
			],
		}).source,
	)
	expect(
		document.objects.find((o) => o.objectNumber === 8)?.value,
	).toMatchObject({
		entries: {
			StdCF: {
				entries: {
					Description: {
						bytes: new TextEncoder().encode("Clear configuration"),
					},
				},
			},
		},
	})
	expect(parsePdf(serializePdf(document))).toEqual(document)
})

it("leaves unconsumed cross-reference streams unencrypted too", () => {
	const document = parsePdf(
		encryptedPdf({
			extraObjects: [[8, "<< /Type /XRef /Length 1 >>\nstream\nx\nendstream"]],
		}).source,
	)
	expect(
		document.objects.find((o) => o.objectNumber === 8)?.value,
	).toMatchObject({ data: Uint8Array.of(120) })
	expect(parsePdf(serializePdf(document))).toEqual(document)
})

it("preserves cleartext direct Info in an encrypted PDF 2.0 cross-reference stream", () => {
	const document = parsePdf(encryptedPdf({ directInfo: true }).source)
	expect(
		document.objects.find((o) => o.objectNumber === document.info?.objectNumber)
			?.value,
	).toMatchObject({
		entries: {
			Title: { bytes: new TextEncoder().encode("Encrypted fixture") },
		},
	})
	expect(parsePdf(serializePdf(document))).toEqual(document)
})
