import { expect, it } from "vite-plus/test"
import {
	array,
	ascii,
	dictionary,
	literalString,
	name,
	stream,
} from "../../src/index.ts"
import { previewPdfPlates } from "../../src/testing.ts"
import { rawDocument } from "./fixtures/plates.ts"
import { parsePlateContent } from "../../src/testing/plate-content.ts"
import { PlateMarkedContent } from "../../src/testing/plate-marked-content.ts"

function document(source: string) {
	return rawDocument((objects) => ({
		contents: [stream({}, ascii(source))],
		resources: dictionary({
			Properties: dictionary({
				Text: objects.add(
					dictionary({
						ActualText: objects.add(literalString(ascii("source text"))),
					}),
				),
				Bad: objects.add(42),
			}),
		}),
	}))
}

it("preserves nested tags, property operands, and marked points without treating metadata as painting", () => {
	const source =
		"/Artifact BMC /Span << /ActualText (EMC /OC BDC rg) /Nested [<< /Key true >>] >> BDC /Point /Text DP /Point MP 1 0 0 0 k 0 0 20 20 re f EMC EMC"
	const plate = previewPdfPlates(document(source))[0]!.document
	const instructions = plate.objects.flatMap(({ value }) =>
		value !== null && typeof value === "object" && value.kind === "stream"
			? parsePlateContent(Buffer.from(value.data).toString("latin1"))
			: [],
	)
	const marks = (values: ReturnType<typeof parsePlateContent>) =>
		values.filter(({ op }) => ["BDC", "BMC", "EMC", "DP", "MP"].includes(op))
	expect(marks(instructions)).toEqual(marks(parsePlateContent(source)))
})

it.each([
	"/OC << /Type /OCG >> BDC EMC",
	"/O#43 /Text BDC EMC",
	"/OC BMC EMC",
	"EMC",
	"/Span BMC",
	"/Span <<>> BDC",
	"/Span BMC 1 EMC",
	"BMC EMC",
	"12 BMC EMC",
	"/Span /Other BMC EMC",
	"/Span BDC EMC",
	"/Span 42 BDC EMC",
	"/Span /Missing BDC EMC",
	"/Span /Bad BDC EMC",
	"/Span << /Key 1 0 R >> BDC EMC",
	"/Span << /Nested [1 0 R] >> BDC EMC",
	"/Span << /ActualText >> BDC EMC",
	"/Span << /Key 1 /Key 2 >> BDC EMC",
	"/Span BMC BT EMC ET",
	"BT /Span BMC ET EMC",
	"/Point DP",
	"1 MP",
	"/Span#xx BMC EMC",
	"BT BT ET ET",
	"BT",
])(
	"rejects optional content or malformed marked-content boundaries: %s",
	(source) => {
		expect(() => previewPdfPlates(document(source))).toThrow()
	},
)

it("validates complete operands and nested byte-name property keys", () => {
	const marked = new PlateMarkedContent(() => undefined)
	expect(() => marked.accept({ op: "BMC", operands: ["/Span extra"] })).toThrow(
		/operand/,
	)
	expect(() =>
		marked.accept({ op: "BDC", operands: ["/Span", "<< /#ff [1 0 R] >>"] }),
	).toThrow(/references/)
	expect(
		marked.accept({ op: "BDC", operands: ["/#ff", "<< /#fe null >>"] }),
	).toBe(true)
	marked.accept({ op: "EMC", operands: [] })
	marked.finish()
})

it.each([
	"/Span BMC BT /Inner << /Lang (en) >> BDC EMC ET EMC",
	"BT /Span /Text BDC EMC ET",
])("allows separately nested marked content and text objects: %s", (source) => {
	expect(previewPdfPlates(document(source))).toHaveLength(4)
})

it("allows a marked sequence to span a page Contents array", () => {
	const source = rawDocument(() => ({
		contents: [
			stream({}, ascii("/Span << /ActualText (source) >> BDC")),
			stream({}, ascii("1 0 0 0 k 0 0 20 20 re f EMC")),
		],
	}))
	expect(previewPdfPlates(source)).toHaveLength(4)
})

it.each(["EMC", "/Span BMC"])(
	"keeps Form boundaries independent from their caller: %s",
	(content) => {
		const source = rawDocument((objects) => ({
			resources: dictionary({
				XObject: dictionary({
					Nested: objects.add(
						stream(
							{
								Type: name("XObject"),
								Subtype: name("Form"),
								BBox: array(0, 0, 80, 80),
							},
							ascii(content),
						),
					),
				}),
			}),
			contents: [stream({}, ascii("/Span BMC /Nested Do EMC"))],
		}))
		expect(() => previewPdfPlates(source)).toThrow(/XObject/)
	},
)
