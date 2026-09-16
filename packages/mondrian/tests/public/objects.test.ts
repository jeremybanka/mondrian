import { expect, it } from "vite-plus/test"
import {
	array,
	ascii,
	asciiTextString,
	dateString,
	dictionary,
	dictionaryEntry,
	generationNumber,
	hexString,
	indirectObject,
	literalString,
	name,
	nameBytes,
	objectNumber,
	reference,
	serializePdfObjectBody,
	stream,
	textString,
} from "mondrian.pdf"

it("preserves explicit object identities and dictionary/array values for graph authors", () => {
	const target = reference(objectNumber(17), generationNumber(2))
	const binaryKey = nameBytes(Uint8Array.of(0x80, 0x20))
	const body = dictionary(
		{ Type: name("Custom"), Values: array(null, true, 3.5, target) },
		dictionaryEntry(binaryKey, false),
	)
	const object = indirectObject(29, body, 4)
	expect(target).toMatchObject({ objectNumber: 17, generation: 2 })
	expect(object).toMatchObject({ objectNumber: 29, generation: 4 })
	expect(object.value.entries.Type.value).toBe("Custom")
	expect(object.value.entries.Values.items).toEqual([null, true, 3.5, target])
	expect(object.value.byteEntries).toEqual([
		[{ kind: "byte-name", bytes: Uint8Array.of(0x80, 0x20) }, false],
	])
	expect(() => objectNumber(0)).toThrow()
	expect(() => generationNumber(1.5)).toThrow()
})

it("preserves binary strings and encodes text and UTC dates", () => {
	const binary = Uint8Array.of(0, 0x28, 0x29, 0x5c, 0xff)
	expect(literalString(binary).bytes).toEqual(binary)
	expect(hexString(binary).bytes).toEqual(binary)
	expect(ascii("A\n~")).toEqual(Uint8Array.of(65, 10, 126))
	expect(() => ascii("é")).toThrow()
	expect(new TextDecoder().decode(asciiTextString("Invoice").bytes)).toBe(
		"Invoice",
	)
	expect(
		new TextDecoder("utf-16be").decode(textString("Résumé 😀").bytes),
	).toBe("Résumé 😀")
	expect(
		new TextDecoder().decode(
			dateString(new Date("2026-01-02T03:04:05Z")).bytes,
		),
	).toMatch(/^D:20260102030405(?:Z|\+00'00')$/u)
})

it("serializes a binary stream body with its derived byte length", () => {
	const data = Uint8Array.of(0, 10, 13, 255, 40, 41)
	const body = serializePdfObjectBody(stream({ Subtype: name("Binary") }, data))
	const syntax = Buffer.from(body).toString("latin1")
	expect(syntax).toMatch(/\/Length\s+6\b/u)
	const delimiter = /\bstream\r?\n/u.exec(syntax)
	expect(delimiter).not.toBeNull()
	const offset = delimiter!.index + delimiter![0].length
	expect(body.slice(offset, offset + data.length)).toEqual(data)
	expect(syntax.slice(offset + data.length)).toMatch(/^\s*endstream\s*$/u)
	expect(() => serializePdfObjectBody(Number.NaN)).toThrow()
})
