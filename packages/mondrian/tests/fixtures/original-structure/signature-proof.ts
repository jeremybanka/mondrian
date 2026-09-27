// SPDX-License-Identifier: MPL-2.0
import { createHash, verify, X509Certificate } from "node:crypto"
import { readFileSync } from "node:fs"

export function signedReceipt(): Uint8Array {
	return Uint8Array.from(
		readFileSync(new URL("signed-receipt.pdf", import.meta.url)),
	)
}

interface DerNode {
	tag: number
	bytes: Buffer
	body: Buffer
	children: DerNode[]
}
/** A deliberately narrow DER reader for the one independently generated CMS fixture. */
function node(bytes: Buffer, offset = 0): DerNode {
	const tag = bytes[offset]!,
		firstLength = bytes[offset + 1]!
	let length = firstLength,
		header = 2
	if (firstLength & 0x80) {
		const count = firstLength & 0x7f
		if (count < 1 || count > 4) throw new Error("Invalid fixture DER length")
		length = 0
		for (let i = 0; i < count; i++)
			length = length * 256 + bytes[offset + 2 + i]!
		header += count
	}
	if (offset + header + length > bytes.length)
		throw new Error("Truncated fixture DER")
	const body = bytes.subarray(offset + header, offset + header + length)
	const children: DerNode[] = []
	if (tag & 0x20) {
		let next = 0
		while (next < body.length) {
			const child = node(body, next)
			children.push(child)
			next += child.bytes.length
		}
	}
	return {
		tag,
		bytes: bytes.subarray(offset, offset + header + length),
		body,
		children,
	}
}
const oid = (value: DerNode, expected: string) => {
	if (value.tag !== 6 || value.body.toString("hex") !== expected)
		throw new Error("Unexpected fixture CMS algorithm")
}

/** Verifies CMS using Node/OpenSSL crypto before invoking any Mondrian PDF parser. */
export function verifyReceiptSignature(bytes: Uint8Array) {
	const source = Buffer.from(bytes).toString("latin1")
	const range = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(
		source,
	)
	const contents = /\/Contents\s*<([\da-fA-F]+)>/.exec(source)
	if (!range || !contents) throw new Error("Missing fixture PDF signature")
	const byteRange = range.slice(1).map(Number) as [
		number,
		number,
		number,
		number,
	]
	const excludedStart = contents.index + contents[0].indexOf("<")
	const excludedEnd = contents.index + contents[0].length
	const coversDocument =
		byteRange[0] === 0 &&
		byteRange[1] === excludedStart &&
		byteRange[2] === excludedEnd &&
		byteRange[2] + byteRange[3] === bytes.length
	const padded = Buffer.from(contents[1]!, "hex"),
		cms = node(padded)
	if (padded.subarray(cms.bytes.length).some((value) => value !== 0))
		throw new Error("Unexpected CMS padding")
	oid(cms.children[0]!, "2a864886f70d010702") // signedData
	const data = cms.children[1]!.children[0]!
	if (data.children.length !== 5)
		throw new Error("Unexpected fixture SignedData layout")
	oid(data.children[1]!.children[0]!.children[0]!, "608648016503040201") // SHA-256
	const encapsulated = data.children[2]!
	oid(encapsulated.children[0]!, "2a864886f70d010701") // detached data
	if (encapsulated.children.length !== 1)
		throw new Error("Fixture CMS must be detached")
	const certificateNode = data.children[3]!.children[0]!
	const certificate = new X509Certificate(certificateNode.bytes)
	const signers = data.children[4]!.children
	if (signers.length !== 1 || signers[0]!.children.length !== 5)
		throw new Error("Fixture requires one signer without signed attributes")
	const signer = signers[0]!.children
	oid(signer[2]!.children[0]!, "608648016503040201")
	oid(signer[3]!.children[0]!, "2a864886f70d010101") // RSA PKCS#1 v1.5
	const issuerAndSerial = signer[1]!.children,
		tbs = certificateNode.children[0]!.children
	if (
		!issuerAndSerial[0]!.bytes.equals(tbs[2]!.bytes) ||
		!issuerAndSerial[1]!.bytes.equals(tbs[0]!.bytes)
	)
		throw new Error("Fixture signer does not match certificate")
	if (signer[4]!.tag !== 4) throw new Error("Missing CMS signature octets")
	const signedBytes = Buffer.concat([
		bytes.subarray(byteRange[0], byteRange[0] + byteRange[1]),
		bytes.subarray(byteRange[2], byteRange[2] + byteRange[3]),
	])
	return {
		byteRange,
		coversDocument,
		signatureValid: verify(
			"sha256",
			signedBytes,
			certificate.publicKey,
			signer[4]!.body,
		),
		selfSignatureValid: certificate.verify(certificate.publicKey),
		certificateSha256: createHash("sha256")
			.update(certificate.raw)
			.digest("hex"),
		signedBytesSha256: createHash("sha256").update(signedBytes).digest("hex"),
		cms: Uint8Array.from(cms.bytes),
	}
}
