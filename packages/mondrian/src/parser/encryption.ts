// SPDX-License-Identifier: MPL-2.0

import { cbc, ecb } from "@noble/ciphers/aes.js"
import { concatBytes, equalBytes } from "@noble/ciphers/utils.js"
import { sha256, sha384, sha512 } from "@noble/hashes/sha2.js"
import type {
	PdfDictionary,
	PdfIndirectValue,
	PdfStream,
	PdfValue,
} from "../objects.ts"
import { PdfParseError } from "./error.ts"
import type { DecodeBudget } from "./limits.ts"
import { isKind } from "./syntax.ts"

// ISO 32000-2, 7.6.4: algorithms 2.A/2.B and the AESV3 crypt filter.
// The PDF format specifies CBC/ECB here; these are format compatibility operations.
function passwordHash(
	password: Uint8Array,
	salt: Uint8Array,
	user: Uint8Array,
	revision: number,
): Uint8Array {
	let digest: Uint8Array = sha256(concatBytes(password, salt, user))
	if (revision === 6) {
		let round = 0
		let last = 0
		while (round < 64 || last > round - 32) {
			const part = concatBytes(password, digest, user)
			const repeated = new Uint8Array(part.length * 64)
			for (let offset = 0; offset < repeated.length; offset += part.length)
				repeated.set(part, offset)
			const encrypted = cbc(digest.subarray(0, 16), digest.subarray(16, 32), {
				disablePadding: true,
			}).encrypt(repeated)
			let selector = 0
			for (let i = 0; i < 16; i++) selector = (selector + encrypted[i]!) % 3
			digest = [sha256, sha384, sha512][selector]!(encrypted)
			last = encrypted[encrypted.length - 1]!
			round++
		}
	}
	return digest.slice(0, 32)
}

export function createDecryption(
	dictionary: PdfDictionary,
	resolve: (value: PdfValue | undefined) => PdfIndirectValue | undefined,
	password: string | Uint8Array = "",
	budget: DecodeBudget,
	offset: number,
): (value: PdfIndirectValue, offset: number) => PdfIndirectValue {
	const fail = (message: string): never => {
		throw new PdfParseError(message, offset)
	}
	const entries = dictionary.entries
	const revision = entries.R
	if (
		!isKind(entries.Filter, "name") ||
		entries.Filter.value !== "Standard" ||
		entries.V !== 5 ||
		(revision !== 5 && revision !== 6) ||
		(entries.Length !== undefined && entries.Length !== 256)
	) {
		return fail(
			"Encrypted PDFs require the AES-256 Standard security handler (V=5, R=5 or R=6)",
		)
	}
	const bytes = (key: string, length: number) => {
		const value = entries[key]
		if (
			(!isKind(value, "literal-string") && !isKind(value, "hex-string")) ||
			value.bytes.length !== length
		)
			return fail(`Invalid encryption ${key}: expected ${length} bytes`)
		return value.bytes
	}
	let candidate: Uint8Array
	if (typeof password === "string") {
		// Unicode passwords require SASLprep for revision 6. Accept preprocessed
		// UTF-8 bytes explicitly instead of silently applying incomplete normalization.
		for (const character of password) {
			const code = character.charCodeAt(0)
			if (code < 0x20 || code > 0x7e)
				fail(
					"Pass non-ASCII passwords as prepared UTF-8 bytes (SASLprep for R=6)",
				)
		}
		candidate = new TextEncoder().encode(password).slice(0, 127)
	} else if (password instanceof Uint8Array) candidate = password.slice(0, 127)
	else return fail("Expected a password string or prepared UTF-8 bytes")
	const user = bytes("U", 48)
	const owner = bytes("O", 48)
	const userKey = bytes("UE", 32)
	const ownerKey = bytes("OE", 32)
	const perms = bytes("Perms", 16)
	const empty = new Uint8Array()
	let wrappingKey: Uint8Array
	let wrappedKey: Uint8Array
	if (
		equalBytes(
			passwordHash(candidate, user.subarray(32, 40), empty, revision),
			user.subarray(0, 32),
		)
	) {
		wrappingKey = passwordHash(candidate, user.subarray(40), empty, revision)
		wrappedKey = userKey
	} else if (
		equalBytes(
			passwordHash(candidate, owner.subarray(32, 40), user, revision),
			owner.subarray(0, 32),
		)
	) {
		wrappingKey = passwordHash(candidate, owner.subarray(40), user, revision)
		wrappedKey = ownerKey
	} else return fail("Incorrect or missing PDF password")
	const key = cbc(wrappingKey, new Uint8Array(16), {
		disablePadding: true,
	}).decrypt(wrappedKey)
	const metadata = entries.EncryptMetadata ?? true
	const permission = entries.P
	if (
		typeof metadata !== "boolean" ||
		typeof permission !== "number" ||
		!Number.isInteger(permission) ||
		permission < -0x80000000 ||
		permission > 0x7fffffff
	)
		return fail("Invalid encryption permissions or EncryptMetadata")
	const permissions = ecb(key, { disablePadding: true }).decrypt(perms)
	const expected = new Uint8Array([
		0,
		0,
		0,
		0,
		255,
		255,
		255,
		255,
		metadata ? 84 : 70,
		97,
		100,
		98,
	])
	new DataView(expected.buffer).setInt32(0, permission, true)
	if (!equalBytes(permissions.subarray(0, 12), expected))
		fail("Encrypted permissions do not match the security dictionary")
	const filters = resolve(entries.CF)
	const encryptedFilter = (value: PdfValue | undefined): boolean => {
		value = value ?? { kind: "name", value: "Identity" }
		if (!isKind(value, "name")) return fail("Invalid crypt filter name")
		if (value.value === "Identity") return false
		const filter = isKind(filters, "dictionary")
			? resolve(filters.entries[value.value])
			: undefined
		if (!isKind(filter, "dictionary"))
			return fail("Missing crypt filter dictionary")
		const method = filter.entries.CFM
		if (method == null || (isKind(method, "name") && method.value === "None"))
			return false
		if (
			!isKind(method, "name") ||
			method.value !== "AESV3" ||
			(filter.entries.Length !== undefined && filter.entries.Length !== 32)
		)
			return fail("Unsupported crypt filter; expected AESV3")
		return true
	}
	const strings = encryptedFilter(entries.StrF)
	const streams = encryptedFilter(entries.StmF)
	const embedded =
		entries.EFF === undefined ? streams : encryptedFilter(entries.EFF)
	return (value, objectOffset) => {
		const decrypt = (data: Uint8Array) => {
			try {
				if (data.length < 32 || data.length % 16 !== 0)
					throw new Error("length")
				return cbc(key, data.subarray(0, 16)).decrypt(data.subarray(16))
			} catch {
				throw new PdfParseError("Invalid AES-256 encrypted data", objectOffset)
			}
		}
		const visit = (item: PdfValue | PdfStream): PdfValue | PdfStream => {
			if (item === null || typeof item !== "object") return item
			if (isKind(item, "literal-string") || isKind(item, "hex-string"))
				return strings
					? Object.freeze({ ...item, bytes: decrypt(item.bytes) })
					: item
			if (isKind(item, "array"))
				return Object.freeze({
					...item,
					items: Object.freeze(
						item.items.map((value) => visit(value) as PdfValue),
					),
				})
			if (!isKind(item, "dictionary") && !isKind(item, "stream")) return item
			const type = resolve(item.entries.Type)
			if (
				isKind(item, "stream") &&
				isKind(type, "name") &&
				type.value === "XRef"
			)
				return item
			const signature =
				isKind(type, "name") &&
				(type.value === "Sig" || type.value === "DocTimeStamp")
			const field = (name: string, value: PdfValue | undefined) =>
				value === undefined || (signature && name === "Contents")
					? value
					: (visit(value) as PdfValue)
			const mapped = {
				...item,
				entries: Object.freeze(
					Object.fromEntries(
						Object.entries(item.entries).map(([name, value]) => [
							name,
							field(name, value),
						]),
					),
				),
				...(item.byteEntries === undefined
					? {}
					: {
							byteEntries: Object.freeze(
								item.byteEntries.map(([name, value]) =>
									Object.freeze([name, visit(value) as PdfValue] as const),
								),
							),
						}),
			}
			if (isKind(item, "stream")) {
				const filter = resolve(item.entries.Filter)
				const filterList = isKind(filter, "array")
					? filter.items.map(resolve)
					: [filter]
				if (filterList.some((f) => isKind(f, "name") && f.value === "Crypt"))
					throw new PdfParseError(
						"Explicit Crypt stream filters are not supported",
						objectOffset,
					)
				const encrypted =
					isKind(type, "name") && type.value === "EmbeddedFile"
						? embedded
						: streams
				const clearMetadata =
					!metadata && isKind(type, "name") && type.value === "Metadata"
				if (encrypted && !clearMetadata) {
					const structure = isKind(type, "name") && type.value === "ObjStm"
					if (structure)
						budget.check(Math.max(0, item.data.length - 32), objectOffset)
					const data = decrypt(item.data)
					if (structure) budget.charge(data.length, objectOffset)
					return Object.freeze({ ...mapped, data }) as PdfStream
				}
			}
			return Object.freeze(mapped) as PdfValue | PdfStream
		}
		return visit(value) as PdfIndirectValue
	}
}
