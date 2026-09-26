import {
	decodePDFRawStream,
	PDFArray,
	PDFDict,
	PDFDocument,
	PDFName,
	PDFRawStream,
} from "pdf-lib"

interface Fill {
	space: string
	components: number[]
}

// Read this fixture's fill operations from the serialized PDF with an independent
// parser. Resolve resource aliases, decode streams, and track q/Q scopes rather
// than matching whole content strings or assuming a particular stream split.
export async function paintedFills(bytes: Uint8Array) {
	const pdf = await PDFDocument.load(bytes)
	const page = pdf.getPages()[0]!
	const spaces = page.node
		.Resources()
		?.lookupMaybe(PDFName.of("ColorSpace"), PDFDict)
	const resolveSpace = (token: string) => {
		const key = PDFName.of(
			token.slice(1).replace(/#[\da-f]{2}/giu, (s) => s.toUpperCase()),
		)
		const value = spaces?.lookup(key)
		if (
			value instanceof PDFArray &&
			value.lookup(0, PDFName).decodeText() === "Separation"
		) {
			return value.lookup(1, PDFName).decodeText()
		}
		if (value instanceof PDFArray && value.size() === 1)
			return value.lookup(0, PDFName).decodeText()
		return value instanceof PDFName ? value.decodeText() : key.decodeText()
	}
	const contents = page.node.Contents()!
	const streams = contents instanceof PDFArray ? contents.asArray() : [contents]
	const syntax = streams
		.map((ref) => {
			const stream = pdf.context.lookup(ref)
			if (!(stream instanceof PDFRawStream))
				throw new Error("Expected a content stream")
			return new TextDecoder().decode(decodePDFRawStream(stream).decode())
		})
		.join("\n")
	const tokens =
		syntax.match(
			/%[^\r\n]*|\((?:\\[\s\S]|[^\\)])*\)|\/[^\s()[\]<>%/]+|[^\s()[\]<>%/]+|[()[\]<>]/gu,
		) ?? []
	let fill: Fill = { space: "DeviceGray", components: [0] }
	const stack: Fill[] = []
	const operands: string[] = []
	const paints: (Fill & { paint: "path" | "text" })[] = []
	for (const token of tokens) {
		if (token.startsWith("%")) continue
		if (
			token.startsWith("/") ||
			token.startsWith("(") ||
			/^[+\-.\d]/u.test(token) ||
			["[", "]", "<", ">"].includes(token)
		) {
			operands.push(token)
			continue
		}
		if (token === "q") stack.push(fill)
		if (token === "Q") fill = stack.pop()!
		if (token === "cs")
			fill = { space: resolveSpace(operands[0]!), components: [] }
		if (["k", "rg", "g", "sc", "scn"].includes(token)) {
			const space =
				(
					{ k: "DeviceCMYK", rg: "DeviceRGB", g: "DeviceGray" } as Record<
						string,
						string
					>
				)[token] ?? fill.space
			fill = { space, components: operands.map(Number) }
		}
		if (["f", "F", "f*", "B", "B*", "b", "b*"].includes(token))
			paints.push({ ...fill, paint: "path" })
		if (["Tj", "TJ", "'", '"'].includes(token))
			paints.push({ ...fill, paint: "text" })
		operands.length = 0
	}
	return paints
}
