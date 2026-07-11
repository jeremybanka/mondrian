/** A CSS color normalized to the PDF DeviceRGB range. */
export interface CssColor {
	readonly red: number
	readonly green: number
	readonly blue: number
	readonly alpha: number
}

type ColorTuple = readonly [
	red: number,
	green: number,
	blue: number,
	alpha: number,
]

const NAMED_COLORS: Readonly<Record<string, ColorTuple>> = {
	transparent: [0, 0, 0, 0],
	black: [0, 0, 0, 255],
	white: [255, 255, 255, 255],
	red: [255, 0, 0, 255],
	yellow: [255, 255, 0, 255],
	blue: [0, 0, 255, 255],
	green: [0, 128, 0, 255],
	gray: [128, 128, 128, 255],
	grey: [128, 128, 128, 255],
	silver: [192, 192, 192, 255],
	maroon: [128, 0, 0, 255],
	purple: [128, 0, 128, 255],
	fuchsia: [255, 0, 255, 255],
	magenta: [255, 0, 255, 255],
	lime: [0, 255, 0, 255],
	olive: [128, 128, 0, 255],
	navy: [0, 0, 128, 255],
	teal: [0, 128, 128, 255],
	aqua: [0, 255, 255, 255],
	cyan: [0, 255, 255, 255],
	orange: [255, 165, 0, 255],
	pink: [255, 192, 203, 255],
	brown: [165, 42, 42, 255],
}

const NUMBER_PATTERN = String.raw`[+-]?(?:(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)`
const NUMBER_TOKEN = new RegExp(
	`^(?<number>${NUMBER_PATTERN})(?<percent>%)?$`,
	`iu`,
)
const FUNCTION_COLOR = /^(?<name>rgb|rgba)\((?<body>.*)\)$/iu

/**
 * Parse the CSS color forms accepted by fitter-happier's PDF adapter.
 *
 * RGB channels and alpha are returned in the inclusive range 0 through 1.
 * Unlike browser CSS parsing, out-of-range channels are rejected rather than
 * silently clamped, so bad layout input produces an actionable diagnostic.
 */
export function parseCssColor(value: string, path = `color`): CssColor {
	if (typeof value !== `string`) {
		throw invalidColor(path, value, `expected a string`)
	}

	const source = value.trim()
	if (source.length === 0) {
		throw invalidColor(path, value, `the color is empty`)
	}

	const named = NAMED_COLORS[source.toLowerCase()]
	if (named !== undefined) return fromByteTuple(named)

	if (source.startsWith(`#`)) return parseHexColor(source, path, value)

	const functional = source.match(FUNCTION_COLOR)
	if (functional?.groups?.name && functional.groups.body !== undefined) {
		return parseFunctionalColor(
			functional.groups.name.toLowerCase() as `rgb` | `rgba`,
			functional.groups.body,
			path,
			value,
		)
	}

	throw invalidColor(path, value, `unsupported color syntax`)
}

function parseHexColor(
	source: string,
	path: string,
	original: string,
): CssColor {
	const digits = source.slice(1)
	if (!/^[\da-f]+$/iu.test(digits)) {
		throw invalidColor(
			path,
			original,
			`hex colors may contain only 0-9 and A-F`,
		)
	}

	if (digits.length === 3 || digits.length === 4) {
		const [red, green, blue, alpha = `f`] = digits
		return fromByteTuple([
			parseHexByte(`${red}${red}`),
			parseHexByte(`${green}${green}`),
			parseHexByte(`${blue}${blue}`),
			parseHexByte(`${alpha}${alpha}`),
		])
	}

	if (digits.length === 6 || digits.length === 8) {
		return fromByteTuple([
			parseHexByte(digits.slice(0, 2)),
			parseHexByte(digits.slice(2, 4)),
			parseHexByte(digits.slice(4, 6)),
			digits.length === 8 ? parseHexByte(digits.slice(6, 8)) : 255,
		])
	}

	throw invalidColor(
		path,
		original,
		`hex colors must have 3, 4, 6, or 8 digits`,
	)
}

function parseFunctionalColor(
	name: `rgb` | `rgba`,
	body: string,
	path: string,
	original: string,
): CssColor {
	return body.includes(`,`)
		? parseLegacyFunctionalColor(name, body, path, original)
		: parseModernFunctionalColor(name, body, path, original)
}

function parseLegacyFunctionalColor(
	name: `rgb` | `rgba`,
	body: string,
	path: string,
	original: string,
): CssColor {
	if (body.includes(`/`)) {
		throw invalidColor(path, original, `comma syntax cannot contain "/"`)
	}

	const parts = body.split(`,`).map((part) => part.trim())
	const expected = name === `rgba` ? 4 : 3
	if (parts.length !== expected || parts.some((part) => part.length === 0)) {
		throw invalidColor(
			path,
			original,
			`${name}() requires exactly ${expected} comma-separated channels`,
		)
	}

	const rgb = parseRgbChannels(parts.slice(0, 3), path, original)
	const alpha = name === `rgba` ? parseAlpha(parts[3]!, path, original) : 1
	return { ...rgb, alpha }
}

function parseModernFunctionalColor(
	name: `rgb` | `rgba`,
	body: string,
	path: string,
	original: string,
): CssColor {
	const slashParts = body.split(`/`)
	if (slashParts.length > 2) {
		throw invalidColor(
			path,
			original,
			`color syntax may contain at most one "/"`,
		)
	}

	const channels = slashParts[0]?.trim().split(/\s+/u) ?? []
	if (channels.length !== 3 || channels.some((part) => part.length === 0)) {
		throw invalidColor(
			path,
			original,
			`${name}() requires exactly three RGB channels`,
		)
	}

	const alphaSource = slashParts[1]?.trim()
	if (name === `rgba` && alphaSource === undefined) {
		throw invalidColor(path, original, `rgba() requires an alpha channel`)
	}
	if (alphaSource !== undefined && alphaSource.split(/\s+/u).length !== 1) {
		throw invalidColor(
			path,
			original,
			`alpha must be a single number or percentage`,
		)
	}

	return {
		...parseRgbChannels(channels, path, original),
		alpha:
			alphaSource === undefined ? 1 : parseAlpha(alphaSource, path, original),
	}
}

function parseRgbChannels(
	parts: readonly string[],
	path: string,
	original: string,
): Pick<CssColor, `red` | `green` | `blue`> {
	const tokens = parts.map((part) => parseNumberToken(part, path, original))
	const percentage = tokens[0]!.percentage
	if (tokens.some((token) => token.percentage !== percentage)) {
		throw invalidColor(
			path,
			original,
			`RGB channels must either all be numbers or all be percentages`,
		)
	}

	const maximum = percentage ? 100 : 255
	const values = tokens.map((token, index) => {
		assertRange(
			token.value,
			0,
			maximum,
			path,
			original,
			`RGB channel ${index + 1}`,
		)
		return token.value / maximum
	})

	return {
		red: values[0]!,
		green: values[1]!,
		blue: values[2]!,
	}
}

function parseAlpha(part: string, path: string, original: string): number {
	const token = parseNumberToken(part, path, original)
	const maximum = token.percentage ? 100 : 1
	assertRange(token.value, 0, maximum, path, original, `alpha`)
	return token.value / maximum
}

function parseNumberToken(
	part: string,
	path: string,
	original: string,
): { readonly value: number; readonly percentage: boolean } {
	const match = part.match(NUMBER_TOKEN)
	if (!match?.groups?.number) {
		throw invalidColor(
			path,
			original,
			`"${part}" is not a number or percentage`,
		)
	}

	const value = Number(match.groups.number)
	if (!Number.isFinite(value)) {
		throw invalidColor(path, original, `color channels must be finite`)
	}

	return { value, percentage: match.groups.percent === `%` }
}

function assertRange(
	value: number,
	minimum: number,
	maximum: number,
	path: string,
	original: string,
	label: string,
): void {
	if (value >= minimum && value <= maximum) return
	throw invalidColor(
		path,
		original,
		`${label} must be between ${minimum} and ${maximum}`,
	)
}

function parseHexByte(value: string): number {
	return Number.parseInt(value, 16)
}

function fromByteTuple([red, green, blue, alpha]: ColorTuple): CssColor {
	return {
		red: red / 255,
		green: green / 255,
		blue: blue / 255,
		alpha: alpha / 255,
	}
}

function invalidColor(path: string, value: unknown, reason: string): TypeError {
	return new TypeError(
		`${path}: invalid CSS color ${renderValue(value)}; ${reason}.`,
	)
}

function renderValue(value: unknown): string {
	if (typeof value === `string`) return JSON.stringify(value)
	return String(value)
}
