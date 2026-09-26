import { expect, it } from "vite-plus/test"
import { ascii, dictionary, name, stream } from "../../src/index.ts"
import { previewPdfPlates } from "../../src/testing.ts"
import { parsePlateContent } from "../../src/testing/plate-content.ts"
import { rawDocument } from "./fixtures/plates.ts"

it.each([
	["S", ["n", "S", "n", "S"]],
	["s", ["h n", "h S", "h n", "h S"]],
	["f", ["f", "n", "n", "f"]],
	["F", ["f", "n", "n", "f"]],
	["f*", ["f*", "n", "n", "f*"]],
	["B", ["f", "S", "n", "B"]],
	["B*", ["f*", "S", "n", "B*"]],
	["b", ["h f", "h S", "h n", "h B"]],
	["b*", ["h f*", "h S", "h n", "h B*"]],
] as const)(
	"preserves closure and fill rules when projecting %s",
	(op, expected) => {
		const contents = projectChannels(`10 10 m 70 10 l 40 70 l ${op}`)
		expect(
			contents.map((instructions) =>
				instructions
					.filter(({ op }) => !["gs", "k", "K", "m", "l"].includes(op))
					.map(({ op }) => op)
					.join(" "),
			),
		).toEqual(expected)
	},
)

it.each([
	[0, [0, 3, 3, 0]],
	[1, [3, 1, 3, 1]],
	[2, [0, 1, 3, 2]],
	[3, [3, 3, 3, 3]],
	[4, [4, 7, 7, 4]],
	[5, [7, 5, 7, 5]],
	[6, [4, 5, 7, 6]],
	[7, [7, 7, 7, 7]],
] as const)(
	"preserves text clipping when projecting rendering mode %s",
	(mode, expected) => {
		const contents = projectChannels(
			`BT /F 24 Tf ${mode} Tr 10 30 Td (Ink) Tj ET`,
		)
		expect(
			contents.map((instructions) =>
				instructions
					.filter(({ op }) => op === "Tr")
					.map(({ operands }) => Number(operands[0])),
			),
		).toEqual(expected.map((mode) => [mode]))
		for (const instructions of contents)
			expect(instructions.find(({ op }) => op === "Tj")?.operands).toEqual([
				"(Ink)",
			])
	},
)

// Cyan retains fill, Magenta stroke, Yellow neither, and Black both.
function projectChannels(commands: string) {
	return previewPdfPlates(
		rawDocument(() => ({
			resources: dictionary({
				Font: dictionary({
					F: dictionary({
						Type: name("Font"),
						Subtype: name("Type1"),
						BaseFont: name("Helvetica"),
					}),
				}),
				ExtGState: dictionary({ Over: dictionary({ OP: true, OPM: 1 }) }),
			}),
			contents: [stream({}, ascii(`/Over gs 1 0 0 1 k 0 1 0 1 K ${commands}`))],
		})),
	).map(({ document }) => {
		const streams = document.objects.flatMap(({ value }) =>
			value !== null && typeof value === "object" && value.kind === "stream"
				? [value]
				: [],
		)
		expect(streams).toHaveLength(1)
		return parsePlateContent(Buffer.from(streams[0]!.data).toString("latin1"))
	})
}

it("tokenizes nested strings, escapes, arrays, hex strings, and comments without finding false paint operators", () => {
	expect(
		parsePlateContent(
			"% 1 0 0 rg\n[(outer(inner) \\( rg) -10 <7267>] TJ /A#2fb BMC << /Key (gs) >> DP EMC",
		),
	).toEqual([
		{ operands: ["[(outer(inner) \\( rg) -10 <7267>]"], op: "TJ" },
		{ operands: ["/A#2fb"], op: "BMC" },
		{ operands: ["<< /Key (gs) >>"], op: "DP" },
		{ operands: [], op: "EMC" },
	])
	for (const invalid of ["(unclosed", "[1", "<zz>", "<ab", "1 0", "]", "<<"])
		expect(() => parsePlateContent(invalid)).toThrow(/Malformed/u)
})
