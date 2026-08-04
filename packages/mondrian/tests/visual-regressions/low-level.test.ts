import { describe, expect, it } from "vite-plus/test"

import type {
	PdfCatalogDictionary,
	PdfPageDictionary,
	PdfPagesDictionary,
} from "../../src/index.ts"
import {
	array,
	ascii,
	createPdfObjectBuilder,
	dictionary,
	name,
	serializePdf,
	stream,
} from "../../src/index.ts"
import { visualArtifactOptions } from "./setup.ts"

describe("low-level PDF visual regressions", () => {
	it("renders raw curves, dashes, clipping, and text resources", async () => {
		const objects = createPdfObjectBuilder()
		const pages = objects.reserve<PdfPagesDictionary>()
		const font = objects.add(
			dictionary({
				Type: name("Font"),
				Subtype: name("Type1"),
				BaseFont: name("Helvetica-Bold"),
				Encoding: name("WinAnsiEncoding"),
			}),
		)
		const commands = [
			"q",
			"0.96 0.97 0.98 rg",
			"0 0 600 400 re f",
			"0.12 0.18 0.32 RG",
			"6 w",
			"35 35 530 330 re S",
			"0.91 0.16 0.22 RG",
			"8 w",
			"55 95 m 135 310 245 65 330 280 c S",
			"0.02 0.65 0.55 RG",
			"[18 10 3 10] 0 d",
			"5 w",
			"55 210 m 520 210 l S",
			"q",
			"350 65 170 110 re W n",
			"0.23 0.51 0.96 rg",
			"330 45 210 150 re f",
			"0.98 0.75 0.14 rg",
			"330 45 m 540 195 l 540 45 l h f",
			"Q",
			"0.12 0.18 0.32 rg",
			"BT",
			"/F1 24 Tf",
			"55 340 Td",
			"(Low-level content stream) Tj",
			"ET",
			"Q",
			"",
		].join("\n")
		const contents = objects.add(stream({}, ascii(commands)))
		const page = objects.add(
			dictionary({
				Type: name("Page"),
				Parent: pages.ref,
				MediaBox: array(0, 0, 600, 400),
				Resources: dictionary({
					Font: dictionary({ F1: font }),
				}),
				Contents: contents,
			}) satisfies PdfPageDictionary,
		)
		pages.set(
			dictionary({
				Type: name("Pages"),
				Kids: array(page),
				Count: 1,
			}) satisfies PdfPagesDictionary,
		)
		const root = objects.add(
			dictionary({
				Type: name("Catalog"),
				Pages: pages.ref,
			}) satisfies PdfCatalogDictionary,
		)

		await expect(serializePdf(objects.build({ root }))).toMatchPdfArtifact(
			"raw-content-stream",
			visualArtifactOptions,
		)
	})
})
