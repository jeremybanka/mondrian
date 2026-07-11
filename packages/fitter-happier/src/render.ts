import type { LayoutStyle, SolvedNode } from "fitter-happier"
import type { PdfVersion, StandardFontName } from "mondrian.pdf"
import { parseCssColor } from "./color.ts"
import type { LayoutNodePdfDiagnostic } from "./diagnostics.ts"
import type { LayoutPdfJpeg } from "./image.ts"
import { parseLayoutJpegDataUrl } from "./image.ts"
import {
	encodeWinAnsiLiteral,
	normalizeLayoutTextStyle,
	wrapLayoutText,
} from "./text.ts"

export interface RenderedFontResource {
	readonly baseFont: StandardFontName
	readonly name: string
}

export interface RenderedImageResource {
	readonly image: LayoutPdfJpeg
	readonly name: string
}

export interface RenderedOpacityResource {
	readonly alpha: number
	readonly name: string
}

export interface RenderedSolvedLayout {
	readonly content: string
	readonly diagnostics: readonly LayoutNodePdfDiagnostic[]
	readonly fonts: readonly RenderedFontResource[]
	readonly images: readonly RenderedImageResource[]
	readonly opacities: readonly RenderedOpacityResource[]
	readonly pageHeight: number
	readonly pageWidth: number
}

interface RenderContext {
	readonly content: string[]
	readonly diagnostics: LayoutNodePdfDiagnostic[]
	readonly fontNames: Map<StandardFontName, string>
	readonly imageResources: Map<string, RenderedImageResource>
	readonly opacityResources: Map<string, RenderedOpacityResource>
	readonly pageHeight: number
	readonly rootX: number
	readonly rootY: number
	readonly version: PdfVersion
}

export function renderSolvedLayout(
	root: SolvedNode,
	version: PdfVersion,
): RenderedSolvedLayout {
	const diagnostics: LayoutNodePdfDiagnostic[] = []
	const pageWidth = root.box.width
	const pageHeight = root.box.height
	if (
		![root.box.x, root.box.y, pageWidth, pageHeight].every(Number.isFinite) ||
		pageWidth <= 0 ||
		pageHeight <= 0
	) {
		diagnostics.push({
			severity: "error",
			code: "invalid-geometry",
			path: root.path,
			message: "The solved root must have finite, positive page geometry",
		})
	}

	const context: RenderContext = {
		content: [],
		diagnostics,
		fontNames: new Map(),
		imageResources: new Map(),
		opacityResources: new Map(),
		pageHeight,
		rootX: root.box.x,
		rootY: root.box.y,
		version,
	}
	renderNode(root, context, 1)
	if (version === "2.0" && context.fontNames.size > 0) {
		diagnostics.push({
			severity: "error",
			code: "unsupported-version-feature",
			path: "version",
			message:
				"PDF 2.0 text requires embedded font programs; Standard 14 fonts are limited to PDF 1.x",
		})
	}

	return {
		content: context.content.join(""),
		diagnostics: Object.freeze([...diagnostics]),
		fonts: Object.freeze(
			[...context.fontNames].map(([baseFont, name]) => ({ baseFont, name })),
		),
		images: Object.freeze([...context.imageResources.values()]),
		opacities: Object.freeze([...context.opacityResources.values()]),
		pageHeight,
		pageWidth,
	}
}

function renderNode(
	node: SolvedNode,
	context: RenderContext,
	inheritedOpacity: number,
): void {
	const style = node.source.style ?? {}
	if (style.display === "none") {
		return
	}
	if (!isFiniteBox(node.box)) {
		context.diagnostics.push({
			severity: "error",
			code: "invalid-geometry",
			path: node.path,
			message: "Solved node geometry must contain finite numbers",
		})
		return
	}
	if (node.box.width < 0 || node.box.height < 0) {
		context.diagnostics.push({
			severity: "error",
			code: "invalid-geometry",
			path: node.path,
			message: "Solved node dimensions cannot be negative",
		})
		return
	}

	let ownOpacity = normalizeOpacity(style.opacity, node.path, context)
	if (ownOpacity !== 1 && node.children.length > 0) {
		context.diagnostics.push({
			severity: "error",
			code: "unsupported-group-opacity",
			path: `${node.path}.style.opacity`,
			message:
				"Opacity on a node with children requires isolated transparency-group compositing",
		})
		ownOpacity = 1
	}
	const opacity = inheritedOpacity * ownOpacity
	if (node.box.width === 0 || node.box.height === 0) {
		if (style.overflow !== "hidden") {
			for (const child of node.children) {
				renderNode(child, context, opacity)
			}
		}
		return
	}

	const box = pageBox(node, context)
	renderBoxBackground(box, style, opacity, node.path, context)

	const clips = style.overflow === "hidden"
	if (clips) {
		context.content.push("q\n", shapePath(box, style.borderRadius), "W n\n")
	}

	if (node.type === "text") {
		renderTextNode(node, box, opacity, context)
	} else if (node.type === "image") {
		renderImageNode(node, box, opacity, context)
	} else if (node.type === "svg") {
		context.diagnostics.push({
			severity: "error",
			code: "unsupported-svg",
			path: node.path,
			message:
				"SVG LayoutNodes are not supported by this compiler; lower the SVG to PDF graphics operations first",
		})
	}

	for (const child of node.children) {
		renderNode(child, context, opacity)
	}

	if (clips) {
		context.content.push("Q\n")
	}
	renderBoxBorder(box, style, opacity, node.path, context)
}

function renderBoxBackground(
	box: PageBox,
	style: LayoutStyle,
	opacity: number,
	path: string,
	context: RenderContext,
): void {
	if (style.backgroundColor !== undefined) {
		try {
			const color = parseCssColor(
				style.backgroundColor,
				`${path}.backgroundColor`,
			)
			const alpha = opacity * color.alpha
			context.content.push(
				"q\n",
				opacityOperator(alpha, path, context),
				`${pdfNumber(color.red)} ${pdfNumber(color.green)} ${pdfNumber(color.blue)} rg\n`,
				shapePath(box, style.borderRadius),
				"f\nQ\n",
			)
		} catch (error) {
			pushColorError(error, `${path}.backgroundColor`, context)
		}
	}
}

function renderBoxBorder(
	box: PageBox,
	style: LayoutStyle,
	opacity: number,
	path: string,
	context: RenderContext,
): void {
	if (style.borderWidth !== undefined && style.borderWidth !== 0) {
		if (!Number.isFinite(style.borderWidth) || style.borderWidth < 0) {
			context.diagnostics.push({
				severity: "error",
				code: "invalid-geometry",
				path: `${path}.borderWidth`,
				message: "Border width must be a finite, nonnegative number",
			})
			return
		}

		try {
			const color = parseCssColor(
				style.borderColor ?? "#111827",
				`${path}.borderColor`,
			)
			const alpha = opacity * color.alpha
			context.content.push(
				"q\n",
				opacityOperator(alpha, path, context),
				`${pdfNumber(color.red)} ${pdfNumber(color.green)} ${pdfNumber(color.blue)} RG\n`,
				`${pdfNumber(style.borderWidth)} w\n`,
				shapePath(box, style.borderRadius),
				"S\nQ\n",
			)
		} catch (error) {
			pushColorError(error, `${path}.borderColor`, context)
		}
	}
}

function renderTextNode(
	node: Extract<SolvedNode, { readonly type: "text" }>,
	box: PageBox,
	opacity: number,
	context: RenderContext,
): void {
	const style = normalizeLayoutTextStyle(node.source.style)
	if (style.fallbackFamily !== undefined) {
		context.diagnostics.push({
			severity: "warning",
			code: "font-fallback",
			path: `${node.path}.style.fontFamily`,
			message: `Font family ${style.fallbackFamily} is rendered with Helvetica`,
		})
	}

	let color
	try {
		color = parseCssColor(style.color, `${node.path}.color`)
	} catch (error) {
		pushColorError(error, `${node.path}.color`, context)
		return
	}

	const lines = wrapLayoutText(node.source.text, box.width, style)
	const fontName = fontResourceName(style.font, context)
	const maximumLines = Math.max(
		0,
		Math.floor((box.height + 0.001) / style.lineHeight),
	)
	const visibleLines = lines.slice(0, maximumLines)

	for (let index = 0; index < visibleLines.length; index += 1) {
		const line = visibleLines[index]
		if (line === undefined) continue
		let x = box.x
		if (style.textAlign === "center") {
			x += Math.max(0, (box.width - line.width) / 2)
		} else if (style.textAlign === "right") {
			x += Math.max(0, box.width - line.width)
		}

		const spaces = countSpaces(line.text)
		const wordSpacing =
			style.textAlign === "justify" && !line.paragraphEnd && spaces > 0
				? Math.max(0, (box.width - line.width) / spaces)
				: 0
		const lineTop = box.top + index * style.lineHeight
		const baseline = context.pageHeight - lineTop - style.fontSize * 0.82

		try {
			const encoded = encodeWinAnsiLiteral(line.text, node.path)
			context.content.push(
				"q\n",
				opacityOperator(opacity * color.alpha, node.path, context),
				`${pdfNumber(color.red)} ${pdfNumber(color.green)} ${pdfNumber(color.blue)} rg\n`,
				"BT\n",
				`/${fontName} ${pdfNumber(style.fontSize)} Tf\n`,
				wordSpacing > 0 ? `${pdfNumber(wordSpacing)} Tw\n` : "",
				`1 0 0 1 ${pdfNumber(x)} ${pdfNumber(baseline)} Tm\n`,
				`${encoded} Tj\n`,
				"ET\nQ\n",
			)
		} catch (error) {
			context.diagnostics.push({
				severity: "error",
				code: "unsupported-text-character",
				path: node.path,
				message:
					error instanceof Error
						? error.message
						: "Text cannot be represented in WinAnsiEncoding",
			})
			return
		}
	}
}

function renderImageNode(
	node: Extract<SolvedNode, { readonly type: "image" }>,
	box: PageBox,
	opacity: number,
	context: RenderContext,
): void {
	let resource = context.imageResources.get(node.source.src)
	try {
		if (resource === undefined) {
			const image = parseLayoutJpegDataUrl(
				node.source.src,
				node.source.intrinsicWidth,
				node.source.intrinsicHeight,
				node.path,
			)
			resource = {
				image,
				name: `Im${context.imageResources.size}`,
			}
			context.imageResources.set(node.source.src, resource)
		} else if (
			resource.image.width !== Math.round(node.source.intrinsicWidth) ||
			resource.image.height !== Math.round(node.source.intrinsicHeight)
		) {
			throw new TypeError(
				`${node.path}: intrinsic dimensions do not match the reused JPEG resource`,
			)
		}
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Invalid LayoutNode image"
		context.diagnostics.push({
			severity: "error",
			code: message.includes("not supported")
				? "unsupported-image"
				: "invalid-image",
			path: node.path,
			message,
		})
		return
	}

	const scale = Math.min(
		box.width / resource.image.width,
		box.height / resource.image.height,
	)
	const width = resource.image.width * scale
	const height = resource.image.height * scale
	const x = box.x + (box.width - width) / 2
	const top = box.top + (box.height - height) / 2
	const y = context.pageHeight - top - height
	context.content.push(
		"q\n",
		opacityOperator(opacity, node.path, context),
		`${pdfNumber(width)} 0 0 ${pdfNumber(height)} ${pdfNumber(x)} ${pdfNumber(y)} cm\n`,
		`/${resource.name} Do\n`,
		"Q\n",
	)
}

interface PageBox {
	readonly height: number
	readonly top: number
	readonly width: number
	readonly x: number
	readonly y: number
}

function pageBox(node: SolvedNode, context: RenderContext): PageBox {
	const x = node.box.x - context.rootX
	const top = node.box.y - context.rootY
	return {
		height: node.box.height,
		top,
		width: node.box.width,
		x,
		y: context.pageHeight - top - node.box.height,
	}
}

function shapePath(box: PageBox, radiusValue: number | undefined): string {
	const radius =
		typeof radiusValue === "number" && Number.isFinite(radiusValue)
			? Math.max(0, Math.min(radiusValue, box.width / 2, box.height / 2))
			: 0
	if (radius === 0) {
		return `${pdfNumber(box.x)} ${pdfNumber(box.y)} ${pdfNumber(box.width)} ${pdfNumber(box.height)} re\n`
	}

	const x0 = box.x
	const x1 = box.x + radius
	const x2 = box.x + box.width - radius
	const x3 = box.x + box.width
	const y0 = box.y
	const y1 = box.y + radius
	const y2 = box.y + box.height - radius
	const y3 = box.y + box.height
	const control = radius * 0.552_284_749_8
	return (
		`${pdfNumber(x1)} ${pdfNumber(y0)} m\n` +
		`${pdfNumber(x2)} ${pdfNumber(y0)} l\n` +
		`${pdfNumber(x2 + control)} ${pdfNumber(y0)} ${pdfNumber(x3)} ${pdfNumber(y1 - control)} ${pdfNumber(x3)} ${pdfNumber(y1)} c\n` +
		`${pdfNumber(x3)} ${pdfNumber(y2)} l\n` +
		`${pdfNumber(x3)} ${pdfNumber(y2 + control)} ${pdfNumber(x2 + control)} ${pdfNumber(y3)} ${pdfNumber(x2)} ${pdfNumber(y3)} c\n` +
		`${pdfNumber(x1)} ${pdfNumber(y3)} l\n` +
		`${pdfNumber(x1 - control)} ${pdfNumber(y3)} ${pdfNumber(x0)} ${pdfNumber(y2 + control)} ${pdfNumber(x0)} ${pdfNumber(y2)} c\n` +
		`${pdfNumber(x0)} ${pdfNumber(y1)} l\n` +
		`${pdfNumber(x0)} ${pdfNumber(y1 - control)} ${pdfNumber(x1 - control)} ${pdfNumber(y0)} ${pdfNumber(x1)} ${pdfNumber(y0)} c\n` +
		"h\n"
	)
}

function fontResourceName(
	font: StandardFontName,
	context: RenderContext,
): string {
	const existing = context.fontNames.get(font)
	if (existing !== undefined) return existing
	const name = `F${context.fontNames.size}`
	context.fontNames.set(font, name)
	return name
}

function opacityOperator(
	alpha: number,
	path: string,
	context: RenderContext,
): string {
	if (alpha >= 1) return ""
	if (!versionAtLeast(context.version, "1.4")) {
		context.diagnostics.push({
			severity: "error",
			code: "unsupported-version-feature",
			path,
			message: `Transparency requires PDF 1.4 or later, not PDF ${context.version}`,
		})
		return ""
	}

	const normalized = Math.max(0, Math.min(1, alpha))
	const key = normalized.toFixed(6)
	let resource = context.opacityResources.get(key)
	if (resource === undefined) {
		resource = {
			alpha: normalized,
			name: `GS${context.opacityResources.size}`,
		}
		context.opacityResources.set(key, resource)
	}
	return `/${resource.name} gs\n`
}

function normalizeOpacity(
	value: number | undefined,
	path: string,
	context: RenderContext,
): number {
	if (value === undefined) return 1
	if (!Number.isFinite(value) || value < 0 || value > 1) {
		context.diagnostics.push({
			severity: "error",
			code: "invalid-opacity",
			path: `${path}.style.opacity`,
			message: "Opacity must be a finite number from 0 through 1",
		})
		return 1
	}
	return value
}

function pushColorError(
	error: unknown,
	path: string,
	context: RenderContext,
): void {
	context.diagnostics.push({
		severity: "error",
		code: "invalid-color",
		path,
		message: error instanceof Error ? error.message : "Invalid CSS color",
	})
}

function isFiniteBox(box: SolvedNode["box"]): boolean {
	return [box.x, box.y, box.width, box.height].every(Number.isFinite)
}

function countSpaces(value: string): number {
	let result = 0
	for (const character of value) {
		if (character === " ") result += 1
	}
	return result
}

function pdfNumber(value: number): string {
	if (!Number.isFinite(value)) {
		throw new TypeError("PDF content numbers must be finite")
	}
	if (Object.is(value, -0)) return "0"

	const source = String(value)
	if (!source.includes("e") && !source.includes("E")) {
		return source
	}

	const match = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/u.exec(source)
	if (match === null) {
		throw new TypeError(`Cannot encode PDF content number: ${source}`)
	}

	const sign = match[1] ?? ""
	const integer = match[2] ?? ""
	const fraction = match[3] ?? ""
	const exponent = Number(match[4])
	const digits = `${integer}${fraction}`
	const decimalIndex = integer.length + exponent
	if (decimalIndex <= 0) {
		return `${sign}0.${"0".repeat(-decimalIndex)}${digits}`
	}
	if (decimalIndex >= digits.length) {
		return `${sign}${digits}${"0".repeat(decimalIndex - digits.length)}`
	}
	return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`
}

function versionAtLeast(version: PdfVersion, minimum: PdfVersion): boolean {
	const order: readonly PdfVersion[] = [
		"1.0",
		"1.1",
		"1.2",
		"1.3",
		"1.4",
		"1.5",
		"1.6",
		"1.7",
		"2.0",
	]
	return order.indexOf(version) >= order.indexOf(minimum)
}
