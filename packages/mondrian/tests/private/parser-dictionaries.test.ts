import { expect, it } from "vitest"
import { parsePdf, serializePdf } from "../../src/index.ts"
import { isKind } from "../../src/parser/syntax.ts"
import { encryptedPdf, encryptFixtureBytes } from "../fixtures/encrypted.ts"

it.each([false, true])(
	"uses owned dictionary entries for plain and decrypted objects (encrypted: %s)",
	(encrypted) => {
		const plaintext = Buffer.from("Special dictionary value")
		const encoded = encrypted ? encryptFixtureBytes(plaintext) : plaintext
		const data = Buffer.from([0, 128, 255])
		const streamData = encrypted ? encryptFixtureBytes(data) : data
		const entries = ["__proto__", "constructor", "toString", "#ff"]
			.map((key) => `/${key} <${encoded.toString("hex")}>`)
			.join(" ")
		const { source } = encryptedPdf({
			strings: encrypted,
			streams: encrypted,
			extraObjects: [
				[5, `<< ${entries} /Nested << ${entries} >> >>`],
				[
					8,
					`<< ${entries} /Length ${streamData.length} >>\nstream\n${streamData.toString("latin1")}\nendstream`,
				],
			],
		})
		const document = parsePdf(source)
		for (const result of [document, parsePdf(serializePdf(document))]) {
			const dictionary = result.objects.find((o) => o.objectNumber === 5)!.value
			const stream = result.objects.find((o) => o.objectNumber === 8)!.value
			if (!isKind(dictionary, "dictionary") || !isKind(stream, "stream"))
				throw new Error("Missing fixture objects")
			for (const value of [dictionary, dictionary.entries.Nested, stream]) {
				if (!isKind(value, "dictionary") && !isKind(value, "stream"))
					throw new Error("Missing fixture dictionary")
				for (const key of ["__proto__", "constructor", "toString"]) {
					expect(Object.hasOwn(value.entries, key)).toBe(true)
					expect(value.entries[key]).toMatchObject({
						bytes: Uint8Array.from(plaintext),
					})
				}
				expect(value.byteEntries).toEqual([
					[
						{ kind: "byte-name", bytes: Uint8Array.of(255) },
						{ kind: "hex-string", bytes: Uint8Array.from(plaintext) },
					],
				])
				// Private construction invariant, not a consumer-facing prototype promise.
				expect(Object.getPrototypeOf(value.entries)).toBeNull()
				expect(Object.isFrozen(value.entries)).toBe(true)
			}
			expect(Object.hasOwn(stream.entries, "Length")).toBe(false)
			expect(stream.data).toEqual(Uint8Array.from(data))
		}
	},
)
