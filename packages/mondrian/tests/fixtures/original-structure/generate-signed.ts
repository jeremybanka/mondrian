// SPDX-License-Identifier: MPL-2.0
// Generation only. A fresh ephemeral private key stays in memory and is never saved.
import { execFile } from "node:child_process"
import {
	createHash,
	createPublicKey,
	generateKeyPairSync,
	sign,
	X509Certificate,
} from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"
import {
	byteRangePlaceholder,
	signatureCapacity,
	unsignedReceipt,
} from "./signing-source.ts"
const run = promisify(execFile)
const openssl = process.env.OPENSSL ?? "openssl"
const version = (await run(openssl, ["version"])).stdout.trim()
if (!version.startsWith("OpenSSL 3.6.4 "))
	throw new Error(`Expected OpenSSL 3.6.4, got ${version}`)
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
// Small X.509 v1 certificate: fixed metadata around this regeneration's fresh key.
const der = (tag: number, ...values: Uint8Array[]): Buffer => {
	const body = Buffer.concat(values)
	const long =
		body.length < 128
			? []
			: [
					...Buffer.from(
						body.length.toString(16).padStart(body.length < 256 ? 2 : 4, "0"),
						"hex",
					),
				]
	return Buffer.concat([
		Buffer.from([
			tag,
			...(long.length ? [0x80 | long.length, ...long] : [body.length]),
		]),
		body,
	])
}
const seq = (...values: Uint8Array[]) => der(0x30, ...values)
const oid = (hex: string) => der(6, Buffer.from(hex, "hex"))
const algorithm = seq(oid("2a864886f70d01010b"), der(5))
const name = seq(
	der(
		0x31,
		seq(
			oid("550403"),
			der(0x0c, Buffer.from("Mondrian original fixture signer; TEST ONLY")),
		),
	),
)
const validity = seq(
	der(0x17, Buffer.from("260101000000Z")),
	der(0x18, Buffer.from("21260101000000Z")),
)
const publicKey = createPublicKey(privateKey).export({
	type: "spki",
	format: "der",
})
const tbs = seq(
	der(2, Buffer.from([1])),
	algorithm,
	name,
	validity,
	name,
	publicKey,
)
const certificate = seq(
	tbs,
	algorithm,
	der(3, Buffer.from([0]), sign("sha256", tbs, privateKey)),
)
const cert = new X509Certificate(certificate)
if (!cert.verify(cert.publicKey))
	throw new Error("Invalid self-signed test certificate")
let source = unsignedReceipt()
const sourceSha256 = createHash("sha256").update(source, "latin1").digest("hex")
const start = source.indexOf("/Contents <") + "/Contents ".length
const end = start + signatureCapacity * 2 + 2
const byteRange = [0, start, end, source.length - end]
source = source.replace(
	byteRangePlaceholder,
	`[0 ${byteRange
		.slice(1)
		.map((n) => String(n).padStart(10, "0"))
		.join(" ")}]`,
)
const sourceBytes = Buffer.from(source, "latin1")
const signedBytes = Buffer.concat([
	sourceBytes.subarray(0, start),
	sourceBytes.subarray(end),
])
const temporary = await mkdtemp(join(tmpdir(), "mondrian-signature-"))
try {
	const content = join(temporary, "content.bin"),
		cms = join(temporary, "signature.der")
	await writeFile(content, signedBytes)
	const digestAlgorithm = seq(oid("608648016503040201")) // SHA-256
	const rsaAlgorithm = seq(oid("2a864886f70d010101"), der(5))
	// Detached CMS SignedData with one signer and no signed attributes.
	// Only the public certificate and cryptographic signature leave memory.
	const signature = seq(
		oid("2a864886f70d010702"),
		der(
			0xa0,
			seq(
				der(2, Buffer.from([1])),
				der(0x31, digestAlgorithm),
				seq(oid("2a864886f70d010701")),
				der(0xa0, certificate),
				der(
					0x31,
					seq(
						der(2, Buffer.from([1])),
						seq(name, der(2, Buffer.from([1]))),
						digestAlgorithm,
						rsaAlgorithm,
						der(4, sign("sha256", signedBytes, privateKey)),
					),
				),
			),
		),
	)
	await writeFile(cms, signature)
	if (signature.length > signatureCapacity)
		throw new Error("Signature fixture capacity exceeded")
	const verify = await run(openssl, [
		"cms",
		"-verify",
		"-binary",
		"-inform",
		"DER",
		"-in",
		cms,
		"-content",
		content,
		"-noverify",
		"-out",
		join(temporary, "verified.bin"),
	])
	const result = Buffer.from(sourceBytes)
	result.write(
		signature.toString("hex").padEnd(signatureCapacity * 2, "0"),
		start + 1,
		"ascii",
	)
	await writeFile(new URL("signed-receipt.pdf", import.meta.url), result)
	const pdfsig = process.env.PDFSIG ?? "pdfsig"
	const pdfsigVersion = (await run(pdfsig, ["-v"])).stderr.split("\n")[0]
	if (pdfsigVersion !== "pdfsig version 26.06.0")
		throw new Error(`Expected Poppler 26.06.0, got ${pdfsigVersion}`)
	const pdfVerification = await run(
		pdfsig,
		[
			"-nocert",
			"-no-ocsp",
			fileURLToPath(new URL("signed-receipt.pdf", import.meta.url)),
		],
		{ env: { ...process.env, TZ: "UTC" } },
	)
	if (
		!pdfVerification.stdout.includes(
			"Signature Validation: Signature is Valid.",
		) ||
		!pdfVerification.stdout.includes("Total document signed")
	)
		throw new Error("Poppler did not validate the full original PDF signature")
	await writeFile(
		new URL("signature-proof.json", import.meta.url),
		JSON.stringify(
			{
				tool: version,
				generator: `Node ${process.version}; ephemeral RSA key and CMS assembly in memory`,
				sourceSha256,
				pdfsigVersion,
				pdfVerification: pdfVerification.stdout.replaceAll(
					fileURLToPath(new URL("signed-receipt.pdf", import.meta.url)),
					"signed-receipt.pdf",
				),
				sha256: createHash("sha256").update(result).digest("hex"),
				signedBytesSha256: createHash("sha256")
					.update(signedBytes)
					.digest("hex"),
				certificateSha256: createHash("sha256")
					.update(certificate)
					.digest("hex"),
				signatureBytes: signature.length,
				byteRange,
				verification: (verify.stdout + verify.stderr).trim(),
				certificateSubject: cert.subject,
				notBefore: cert.validFrom,
				notAfter: cert.validTo,
				trust: "self-signed test certificate; cryptographic integrity only",
			},
			null,
			"\t",
		) + "\n",
	)
} finally {
	await rm(temporary, { recursive: true, force: true })
}
