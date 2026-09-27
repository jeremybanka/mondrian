// SPDX-License-Identifier: MPL-2.0
// Offline maintenance command only. Tests read the committed asset.
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { colorPixels, imageHeight, imageWidth } from "./pixels.ts"

const encoder = process.argv[2] ?? "opj_compress"
// The OpenJPEG help command exits with status 1 even on success.
const version = spawnSync(encoder, ["-h"], { encoding: "utf8" }).stdout
if (!version.includes("openjp2 library v2.5.4"))
	throw new Error("Regeneration requires OpenJPEG 2.5.4")
const temporary = mkdtempSync(join(tmpdir(), "mondrian-original-jp2-"))
try {
	const source = join(temporary, "color-study.ppm")
	writeFileSync(
		source,
		Buffer.concat([
			Buffer.from(`P6\n${imageWidth} ${imageHeight}\n255\n`),
			colorPixels(),
		]),
	)
	execFileSync(
		encoder,
		[
			"-i",
			source,
			"-o",
			fileURLToPath(new URL("color-study.jp2", import.meta.url)),
			"-r",
			"1",
			"-n",
			"4",
			"-mct",
			"0",
			"-C",
			"Original Mondrian arithmetic color study",
		],
		{ stdio: "inherit" },
	)
} finally {
	rmSync(temporary, { recursive: true, force: true })
}
