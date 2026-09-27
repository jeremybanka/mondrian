// SPDX-License-Identifier: MPL-2.0
// Generation only: qpdf is not invoked by tests.
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { linearizationSource } from "./booklet.ts"
const run = promisify(execFile)
const qpdf = process.env.QPDF ?? "qpdf"
const version = (await run(qpdf, ["--version"])).stdout.split("\n")[0]
if (version !== "qpdf version 12.3.2")
	throw new Error(`Expected qpdf 12.3.2, got ${version}`)
const temporary = await mkdtemp(join(tmpdir(), "mondrian-linearized-"))
try {
	const input = join(temporary, "input.pdf"),
		output = join(temporary, "linearized-garden.pdf")
	const source = linearizationSource()
	await writeFile(input, source)
	await run(qpdf, ["--linearize", "--deterministic-id", input, output])
	const syntax = await run(qpdf, ["--check", output])
	const linearization = await run(qpdf, ["--check-linearization", output])
	const hints = await run(qpdf, ["--show-linearization", output])
	const bytes = await readFile(output)
	await writeFile(new URL("linearized-garden.pdf", import.meta.url), bytes)
	const normalize = (value: string) =>
		value.replaceAll(output, "linearized-garden.pdf")
	await writeFile(
		new URL("linearization-proof.json", import.meta.url),
		JSON.stringify(
			{
				tool: version,
				sourceSha256: createHash("sha256").update(source).digest("hex"),
				sha256: createHash("sha256").update(bytes).digest("hex"),
				bytes: bytes.length,
				check: normalize(syntax.stdout + syntax.stderr),
				checkLinearization: normalize(
					linearization.stdout + linearization.stderr,
				),
				hints: normalize(hints.stdout + hints.stderr),
			},
			null,
			"\t",
		) + "\n",
	)
} finally {
	await rm(temporary, { recursive: true, force: true })
}
