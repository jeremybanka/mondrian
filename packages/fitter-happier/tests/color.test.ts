import { describe, expect, it } from "vite-plus/test"
import { parseCssColor } from "../src/color.ts"

describe(`parseCssColor`, () => {
	it.each([
		[`#f80`, { red: 1, green: 136 / 255, blue: 0, alpha: 1 }],
		[`#f808`, { red: 1, green: 136 / 255, blue: 0, alpha: 136 / 255 }],
		[`#FF8000`, { red: 1, green: 128 / 255, blue: 0, alpha: 1 }],
		[`#ff800040`, { red: 1, green: 128 / 255, blue: 0, alpha: 64 / 255 }],
	])(`parses hex color %s`, (input, expected) => {
		expect(parseCssColor(input)).toEqual(expected)
	})

	it.each([
		[`rgb(255, 128, 0)`, { red: 1, green: 128 / 255, blue: 0, alpha: 1 }],
		[
			`rgba(255, 128, 0, 0.25)`,
			{ red: 1, green: 128 / 255, blue: 0, alpha: 0.25 },
		],
		[`rgb(100%, 50%, 0%)`, { red: 1, green: 0.5, blue: 0, alpha: 1 }],
		[`rgba(100%, 50%, 0%, 25%)`, { red: 1, green: 0.5, blue: 0, alpha: 0.25 }],
		[`rgb(255 128 0)`, { red: 1, green: 128 / 255, blue: 0, alpha: 1 }],
		[`rgb(100% 50% 0% / 25%)`, { red: 1, green: 0.5, blue: 0, alpha: 0.25 }],
		[`rgba(255 128 0 / .5)`, { red: 1, green: 128 / 255, blue: 0, alpha: 0.5 }],
	])(`parses functional color %s`, (input, expected) => {
		expect(parseCssColor(input)).toEqual(expected)
	})

	it.each([
		[`transparent`, { red: 0, green: 0, blue: 0, alpha: 0 }],
		[`black`, { red: 0, green: 0, blue: 0, alpha: 1 }],
		[`white`, { red: 1, green: 1, blue: 1, alpha: 1 }],
		[`red`, { red: 1, green: 0, blue: 0, alpha: 1 }],
		[`yellow`, { red: 1, green: 1, blue: 0, alpha: 1 }],
		[`blue`, { red: 0, green: 0, blue: 1, alpha: 1 }],
		[`green`, { red: 0, green: 128 / 255, blue: 0, alpha: 1 }],
		[`gray`, { red: 128 / 255, green: 128 / 255, blue: 128 / 255, alpha: 1 }],
		[`grey`, { red: 128 / 255, green: 128 / 255, blue: 128 / 255, alpha: 1 }],
	])(`parses named color %s`, (input, expected) => {
		expect(parseCssColor(`  ${input.toUpperCase()}  `)).toEqual(expected)
	})

	it.each([
		``,
		`#12`,
		`#12345`,
		`#ggg`,
		`rgb(255, 0)`,
		`rgba(255, 0, 0)`,
		`rgb(256, 0, 0)`,
		`rgb(-1, 0, 0)`,
		`rgb(101%, 0%, 0%)`,
		`rgb(100%, 0, 0)`,
		`rgba(0, 0, 0, 1.1)`,
		`rgba(0 0 0 / -1%)`,
		`rgb(none 0 0)`,
		`hsl(0 100% 50%)`,
		`not-a-color`,
	])(`rejects invalid color %j`, (input) => {
		const parse = () => parseCssColor(input, `nodes[2].style.color`)
		expect(parse).toThrowError(TypeError)
		expect(parse).toThrowError(/nodes\[2\]\.style\.color: invalid CSS color/u)
	})

	it(`rejects non-string interchange data with its source path`, () => {
		expect(() =>
			parseCssColor(null as unknown as string, `root.style.backgroundColor`),
		).toThrowError(/root\.style\.backgroundColor: invalid CSS color null/u)
	})
})
