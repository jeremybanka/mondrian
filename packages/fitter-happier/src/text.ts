import type { LayoutStyle, TextMeasurer } from "fitter-happier"
import type { StandardFontName } from "mondrian.pdf"

export interface LayoutPdfTextStyle {
	readonly color: string
	readonly font: StandardFontName
	readonly fontSize: number
	readonly lineHeight: number
	readonly textAlign: "center" | "justify" | "left" | "right"
	readonly fallbackFamily?: string
}

export interface LayoutPdfTextLine {
	readonly text: string
	readonly width: number
	readonly paragraphEnd: boolean
}

const winAnsiSpecialCharacters = new Map<number, number>([
	[0x20ac, 0x80],
	[0x201a, 0x82],
	[0x0192, 0x83],
	[0x201e, 0x84],
	[0x2026, 0x85],
	[0x2020, 0x86],
	[0x2021, 0x87],
	[0x02c6, 0x88],
	[0x2030, 0x89],
	[0x0160, 0x8a],
	[0x2039, 0x8b],
	[0x0152, 0x8c],
	[0x017d, 0x8e],
	[0x2018, 0x91],
	[0x2019, 0x92],
	[0x201c, 0x93],
	[0x201d, 0x94],
	[0x2022, 0x95],
	[0x2013, 0x96],
	[0x2014, 0x97],
	[0x02dc, 0x98],
	[0x2122, 0x99],
	[0x0161, 0x9a],
	[0x203a, 0x9b],
	[0x0153, 0x9c],
	[0x017e, 0x9e],
	[0x0178, 0x9f],
])

export function normalizeLayoutTextStyle(
	style: LayoutStyle | undefined,
): LayoutPdfTextStyle {
	const fontSize = finiteOr(style?.fontSize, 14)
	const lineHeight = finiteOr(style?.lineHeight, Math.round(fontSize * 1.25))
	const family = style?.fontFamily ?? "Helvetica"
	const font = resolveStandardFont(family, style?.fontWeight, style?.fontStyle)
	const normalizedFamily = family.toLowerCase()
	const knownFamily = ["arial", "courier", "helvetica", "sans", "times"].some(
		(name) => normalizedFamily.includes(name),
	)

	return {
		color: style?.color ?? "#111827",
		font,
		fontSize,
		lineHeight,
		textAlign: style?.textAlign ?? "left",
		...(knownFamily ? {} : { fallbackFamily: family }),
	}
}

export function createLayoutPdfTextMeasurer(): TextMeasurer {
	return {
		measure(input) {
			const style = normalizeLayoutTextStyle(input.style)
			const availableWidth =
				input.widthMode === "undefined"
					? Number.POSITIVE_INFINITY
					: Math.max(1, input.availableWidth)
			const lines = wrapLayoutText(input.text, availableWidth, style)
			const widestLine = Math.max(1, ...lines.map((line) => line.width))
			return {
				width:
					input.widthMode === "exactly"
						? availableWidth
						: Math.min(availableWidth, widestLine),
				height: Math.max(1, lines.length) * style.lineHeight,
				lineCount: Math.max(1, lines.length),
			}
		},
	}
}

export function wrapLayoutText(
	text: string,
	maxWidth: number,
	style: LayoutPdfTextStyle,
): readonly LayoutPdfTextLine[] {
	const lines: LayoutPdfTextLine[] = []
	const paragraphs = text
		.replaceAll("\r\n", "\n")
		.replaceAll("\r", "\n")
		.split("\n")

	for (const paragraph of paragraphs) {
		const words =
			paragraph.trim().length === 0 ? [] : paragraph.trim().split(/\s+/u)
		if (words.length === 0) {
			lines.push({ text: "", width: 0, paragraphEnd: true })
			continue
		}

		let current = ""
		for (const word of words) {
			const next = current.length === 0 ? word : `${current} ${word}`
			if (
				current.length > 0 &&
				Number.isFinite(maxWidth) &&
				measureLayoutText(next, style) > maxWidth
			) {
				lines.push({
					text: current,
					width: measureLayoutText(current, style),
					paragraphEnd: false,
				})
				current = ""
			}

			if (
				current.length === 0 &&
				Number.isFinite(maxWidth) &&
				measureLayoutText(word, style) > maxWidth
			) {
				const fragments = breakWord(word, maxWidth, style)
				for (const fragment of fragments.slice(0, -1)) {
					lines.push({
						text: fragment,
						width: measureLayoutText(fragment, style),
						paragraphEnd: false,
					})
				}
				current = fragments.at(-1) ?? ""
			} else {
				current = current.length === 0 ? word : `${current} ${word}`
			}
		}

		lines.push({
			text: current,
			width: measureLayoutText(current, style),
			paragraphEnd: true,
		})
	}

	return lines.length === 0
		? [{ text: "", width: 0, paragraphEnd: true }]
		: lines
}

export function measureLayoutText(
	text: string,
	style: LayoutPdfTextStyle,
): number {
	let emWidth = 0
	for (const character of text) {
		emWidth += glyphWidth(character, style.font)
	}
	return emWidth * style.fontSize
}

export function encodeWinAnsiLiteral(value: string, path: string): string {
	let result = "("
	for (const character of value) {
		const codePoint = character.codePointAt(0)
		if (codePoint === undefined) {
			continue
		}

		const byte = toWinAnsiByte(codePoint)
		if (byte === undefined) {
			throw new TypeError(
				`${path}: character U+${codePoint.toString(16).toUpperCase().padStart(4, "0")} is not representable in WinAnsiEncoding`,
			)
		}

		switch (byte) {
			case 0x28:
				result += "\\("
				break
			case 0x29:
				result += "\\)"
				break
			case 0x5c:
				result += "\\\\"
				break
			default:
				result +=
					byte < 0x20 || byte > 0x7e
						? `\\${byte.toString(8).padStart(3, "0")}`
						: String.fromCharCode(byte)
		}
	}
	return `${result})`
}

function resolveStandardFont(
	family: string,
	weight: number | string | undefined,
	fontStyle: string | undefined,
): StandardFontName {
	const normalized = family.toLowerCase()
	const bold = isBold(weight)
	const italic = fontStyle === "italic" || fontStyle === "oblique"

	if (normalized.includes("courier")) {
		if (bold && italic) return "Courier-BoldOblique"
		if (bold) return "Courier-Bold"
		if (italic) return "Courier-Oblique"
		return "Courier"
	}

	if (normalized.includes("times")) {
		if (bold && italic) return "Times-BoldItalic"
		if (bold) return "Times-Bold"
		if (italic) return "Times-Italic"
		return "Times-Roman"
	}

	if (bold && italic) return "Helvetica-BoldOblique"
	if (bold) return "Helvetica-Bold"
	if (italic) return "Helvetica-Oblique"
	return "Helvetica"
}

function isBold(weight: number | string | undefined): boolean {
	if (typeof weight === "number") {
		return weight >= 600
	}
	if (typeof weight !== "string") {
		return false
	}

	const normalized = weight.toLowerCase()
	return (
		normalized === "bold" ||
		normalized === "bolder" ||
		Number.parseInt(normalized, 10) >= 600
	)
}

function glyphWidth(character: string, font: StandardFontName): number {
	if (font.startsWith("Courier")) {
		return 0.6
	}

	if (character === " ") return font.startsWith("Times") ? 0.25 : 0.278
	if (/[ilI'`.,:;!|]/u.test(character)) return 0.278
	if (/[mwMW@%&]/u.test(character))
		return font.startsWith("Times") ? 0.82 : 0.86
	if (/[A-Z]/u.test(character)) return font.startsWith("Times") ? 0.67 : 0.667
	if (/[0-9]/u.test(character)) return font.startsWith("Times") ? 0.5 : 0.556
	if (/[-+*/=<>()[\]{}]/u.test(character)) return 0.5
	return font.startsWith("Times") ? 0.48 : 0.52
}

function breakWord(
	word: string,
	maxWidth: number,
	style: LayoutPdfTextStyle,
): string[] {
	const fragments: string[] = []
	let current = ""
	for (const character of word) {
		const next = `${current}${character}`
		if (current.length > 0 && measureLayoutText(next, style) > maxWidth) {
			fragments.push(current)
			current = character
		} else {
			current = next
		}
	}
	if (current.length > 0) {
		fragments.push(current)
	}
	return fragments.length === 0 ? [word] : fragments
}

function toWinAnsiByte(codePoint: number): number | undefined {
	if (
		(codePoint >= 0x20 && codePoint <= 0x7e) ||
		(codePoint >= 0xa0 && codePoint <= 0xff)
	) {
		return codePoint
	}
	return winAnsiSpecialCharacters.get(codePoint)
}

function finiteOr(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: fallback
}
