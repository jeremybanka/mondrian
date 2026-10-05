import { parsePdf, validatePdf } from "mondrian.pdf"
import { describe, expect, it } from "vitest"

import { chapters } from "../src/chapters.ts"
import { chapterHref, resolveChapter } from "../src/router.ts"
import {
	byteText,
	createSpecimen,
	drawingCommands,
	fileSections,
	specimenBytes,
} from "../src/specimen.ts"

describe("the guide’s actual PDF specimen", () => {
	it("round-trips through Mondrian with a valid page, content stream, and font", () => {
		const parsed = parsePdf(specimenBytes())
		expect(validatePdf(parsed)).toEqual([])
		expect(parsed.root.objectNumber).toBe(1)
		expect(parsed.objects).toHaveLength(5)
		expect(
			parsed.objects.find((object) => object.objectNumber === 3)?.value,
		).toEqual(createSpecimen().objects[2]?.value)
		expect(
			parsed.objects.find((object) => object.objectNumber === 4)?.value,
		).toEqual(createSpecimen().objects[3]?.value)
	})
	it("keeps displayed file sections and cross-reference offsets tied to the bytes", () => {
		const bytes = specimenBytes()
		const source = byteText(bytes)
		const sections = fileSections()
		expect(sections.map((section) => section.syntax).join("")).toBe(source)
		expect(sections.at(-1)?.end).toBe(bytes.length)
		const xref = sections.find((section) => section.id === "xref")!
		expect(source).toContain(`startxref\n${xref.start}\n%%EOF`)
		const rows = xref.syntax.trim().split("\n").slice(3)
		for (let index = 0; index < rows.length; index++) {
			const offset = Number(rows[index]!.slice(0, 10))
			expect(source.slice(offset)).toMatch(new RegExp(`^${index + 1} 0 obj\\n`))
		}
	})
	it("writes the rectangle position from the interactive state into the downloadable PDF", () => {
		for (const x of [12, 48, 168]) {
			const parsed = parsePdf(specimenBytes(x))
			const content = parsed.objects.find(
				(object) => object.objectNumber === 4,
			)?.value
			expect(validatePdf(parsed)).toEqual([])
			if (content && typeof content === "object" && content.kind === "stream") {
				expect(byteText(content.data)).toBe(
					drawingCommands(x).join("\n") + "\n",
				)
			} else throw new Error("Specimen lost its content stream")
		}
	})
})

describe("chapter routes", () => {
	it("accepts every contents link and rejects nonexistent and extra segments", () => {
		for (const chapter of chapters)
			expect(resolveChapter(chapterHref(chapter.id))).toBe(chapter.id)
		expect(resolveChapter("/pages/")).toBe("pages")
		expect(resolveChapter("/missing")).toBeNull()
		expect(resolveChapter("/pages/missing")).toBeNull()
	})
})
