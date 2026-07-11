/**
 * Development-only view of fitter-happier's public bridge surface.
 *
 * The sibling prototype currently publishes raw TypeScript, so resolving its
 * barrel during this workspace's strict typecheck also checks unrelated Bun,
 * Skia, and PDFKit implementation files. This package-local declaration keeps
 * that incompatibility out of the rest of the Mondrian workspace. Runtime
 * integration tests still execute the real peer package.
 */
export type Length = number | `${number}%` | "auto"
export type EdgeLength = number | `${number}%`
export type LayoutMeasureMode = "at-most" | "exactly" | "undefined"

export interface LayoutStyle {
	alignContent?:
		| "auto"
		| "baseline"
		| "center"
		| "flex-end"
		| "flex-start"
		| "space-around"
		| "space-between"
		| "stretch"
	alignItems?: LayoutStyle["alignContent"]
	alignSelf?: LayoutStyle["alignContent"]
	backgroundColor?: string
	borderColor?: string
	borderRadius?: number
	borderWidth?: number
	bottom?: EdgeLength
	color?: string
	display?: "none"
	flexBasis?: number
	flexDirection?: "column-reverse" | "column" | "row-reverse" | "row"
	flexGrow?: number
	flexShrink?: number
	flexWrap?: "nowrap" | "wrap-reverse" | "wrap"
	fontFamily?: string
	fontSize?: number
	fontStyle?: string
	fontWeight?: number | string
	gap?: number
	height?: Length
	justifyContent?:
		| "center"
		| "flex-end"
		| "flex-start"
		| "space-around"
		| "space-between"
		| "space-evenly"
	left?: EdgeLength
	lineHeight?: number
	margin?: Length
	marginBottom?: Length
	marginLeft?: Length
	marginRight?: Length
	marginTop?: Length
	maxHeight?: Length
	maxWidth?: Length
	minHeight?: Length
	minWidth?: Length
	opacity?: number
	overflow?: "hidden"
	padding?: number
	paddingBottom?: number
	paddingLeft?: number
	paddingRight?: number
	paddingTop?: number
	position?: "absolute"
	right?: EdgeLength
	textAlign?: "center" | "justify" | "left" | "right"
	top?: EdgeLength
	width?: Length
}

interface BaseNode {
	id?: string
	style?: LayoutStyle
}

export interface BoxNode extends BaseNode {
	type: "box"
	children?: LayoutNode[]
}

export interface TextNode extends BaseNode {
	type: "text"
	text: string
}

export interface ImageNode extends BaseNode {
	type: "image"
	src: string
	intrinsicWidth: number
	intrinsicHeight: number
}

export interface SvgNode extends BaseNode {
	type: "svg"
	svg: string
	intrinsicWidth: number
	intrinsicHeight: number
	preserveAspectRatio?: string
}

export interface ComponentNode extends BaseNode {
	type: "component"
	use: unknown
	props: unknown
}

export type LayoutNode =
	| BoxNode
	| ComponentNode
	| ImageNode
	| SvgNode
	| TextNode

export interface LayoutBox {
	x: number
	y: number
	width: number
	height: number
}

export interface LayoutDiagnostic {
	level: "error" | "warning"
	nodeId?: string
	message: string
	detail?: Record<string, unknown>
}

interface SolvedNodeBase {
	id?: string
	path: string
	box: LayoutBox
	localBox: LayoutBox
	children: SolvedNode[]
}

export type SolvedNode =
	| (SolvedNodeBase & {
			type: "box"
			source: BaseNode & { type: "box" }
	  })
	| (SolvedNodeBase & {
			type: "component"
			source: BaseNode & {
				type: "component"
				componentName?: string
				componentType: string
			}
	  })
	| (SolvedNodeBase & {
			type: "image"
			source: BaseNode & {
				type: "image"
				src: string
				intrinsicWidth: number
				intrinsicHeight: number
			}
	  })
	| (SolvedNodeBase & {
			type: "svg"
			source: BaseNode & {
				type: "svg"
				svg: string
				intrinsicWidth: number
				intrinsicHeight: number
				preserveAspectRatio?: string
			}
	  })
	| (SolvedNodeBase & {
			type: "text"
			source: BaseNode & { type: "text"; text: string }
	  })

export interface LayoutResult {
	root: SolvedNode
	diagnostics: LayoutDiagnostic[]
	componentResolutions: readonly unknown[]
}

export interface TextMeasureInput {
	text: string
	style: {
		fontFamily: string
		fontSize: number
		fontStyle: string
		fontWeight: number | string
		lineHeight: number
		color: string
	}
	availableWidth: number
	widthMode: LayoutMeasureMode
	availableHeight: number
	heightMode: LayoutMeasureMode
}

export interface TextMeasureResult {
	width: number
	height: number
	lineCount: number
}

export interface TextMeasurer {
	measure(input: TextMeasureInput): TextMeasureResult
}

export function computeLayout(
	root: LayoutNode,
	options: {
		width: number
		height?: number
		textMeasurer?: TextMeasurer
	},
): Promise<LayoutResult>

export function box(input?: Omit<BoxNode, "type">): BoxNode
export function text(input: Omit<TextNode, "type">): TextNode
export function image(input: Omit<ImageNode, "type">): ImageNode
export function svg(input: Omit<SvgNode, "type">): SvgNode
