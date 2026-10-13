export const objectExplanations: Readonly<
	Record<string, { text: string; lesson: string }>
> = {
	Catalog: {
		text: "The document’s entry point. /Pages identifies the page-tree root; other entries can link metadata, outlines, and output conditions.",
		lesson: "/pages",
	},
	Pages: {
		text: "A page-tree branch. /Kids lists immediate children; /Count counts descendant pages. Page attributes can be inherited from this node.",
		lesson: "/pages",
	},
	Page: {
		text: "A page’s geometry, resources, and drawing program. /Parent links upward; /Contents links to streams that paint it.",
		lesson: "/pages",
	},
	"Content stream": {
		text: "Operands and drawing operators, encoded using the declared filters. Graphics state and resources give the program its meaning.",
		lesson: "/drawing",
	},
	Bitmap: {
		text: "An Image XObject. Color space explains the pixel components; filters encode samples, and /SMask can reference a separate opacity image.",
		lesson: "/mondrian#color",
	},
	"Soft mask": {
		text: "A grayscale image describing per-pixel opacity. It is separate from the parent image’s color samples.",
		lesson: "/mondrian#color",
	},
	"ICC profile": {
		text: "Profile bytes describe how color components map to a defined color space. /N declares the channel count. Source profiles and destination OutputIntents have different roles.",
		lesson: "/mondrian#color",
	},
	Font: {
		text: "A resource used by text operators. Page-local names such as /F1 refer to this object; encoding and Unicode mapping relate bytes to glyphs and text.",
		lesson: "/drawing",
	},
	FontDescriptor: {
		text: "Font metrics and characteristics, with optional references to embedded font programs.",
		lesson: "/objects",
	},
	"Font program": {
		text: "Embedded font data. These decoded bytes are a font file rather than a page drawing program.",
		lesson: "/objects",
	},
	"Form XObject": {
		text: "A reusable drawing program with its own bounds and optional resources. Invocations inherit graphics state, so one object can paint differently in different contexts.",
		lesson: "/drawing",
	},
	Stream: {
		text: "A dictionary accompanied by encoded bytes. Filters describe decoding; references and context determine what the bytes mean.",
		lesson: "/objects",
	},
	Dictionary: {
		text: "Name keys associate PDF values. References connect the dictionary to other objects. Many dictionaries have no /Type entry.",
		lesson: "/objects",
	},
	Value: {
		text: "An indirect primitive or array, identified by its object number and generation.",
		lesson: "/objects",
	},
}
export const fieldExplanations: Readonly<Record<string, string>> = {
	Type: "Declares this dictionary’s type when the format requires it.",
	Subtype: "Refines a resource type, such as Image or Form.",
	Pages:
		"In the Catalog, this reference identifies the page-tree root. Follow /Kids through its branches to the Page objects, whose /Contents streams draw the visible pages.",
	Parent:
		"On a Page or Pages node, this reference points upward to the parent Pages branch. Page geometry and resources may be inherited from its ancestors.",
	Kids: "On a Pages branch, these ordered references identify immediate Page or Pages children. Their order determines the document’s page order.",
	Count:
		"On a Pages branch, this is the number of descendant Page objects, including pages inside nested branches; it is not simply the length of /Kids.",
	MediaBox:
		"Page bounds [left, bottom, right, top] in user-space units; may be inherited.",
	CropBox: "Visible page bounds; defaults to the effective MediaBox.",
	Resources:
		"Names used by drawing commands map to fonts, images, forms, color spaces, and graphics states.",
	Contents: "Drawing stream or ordered array of streams.",
	Filter: "Encoding filters, applied in sequence when decoding.",
	DecodeParms: "Filter settings, including image predictors.",
	Length:
		"Encoded length in the input. Mondrian derives lengths during serialization.",
	ColorSpace: "Defines the interpretation and number of color components.",
	BitsPerComponent: "Precision of each pixel component.",
	Width: "Pixel columns in this image.",
	Height: "Pixel rows in this image.",
	SMask: "References a grayscale opacity image.",
	ImageMask: "A stencil uses the color in the surrounding graphics state.",
	N: "ICC component count, or a function exponent; context determines the meaning.",
	Alternate:
		"Fallback color space when the primary space cannot be interpreted.",
	Intent: "Image color rendering intent.",
	OutputIntents:
		"Declared destination conditions; metadata alone does not convert samples.",
	DestOutputProfile: "ICC profile for the declared destination condition.",
	Group: "Transparency settings, including the blending color space.",
	CS: "Transparency group blending color space.",
	Font: "Named font resources selected by Tf.",
	XObject: "Named images and Forms invoked by Do.",
	BaseFont: "Font base name; encoding and embedding still matter.",
	ToUnicode:
		"Character-code to Unicode mapping for extraction and accessibility.",
	FontFile: "Embedded font program.",
	FontFile2: "Embedded TrueType font program.",
	FontFile3: "Another embedded font-program format.",
	Rotate: "Clockwise page rotation; may be inherited.",
	BBox: "Form’s local bounding box.",
	Matrix: "Transforms the resource’s local coordinate system.",
	Decode:
		"Maps encoded samples to component values; may invert or scale channels.",
	Interpolate: "Requests interpolation when scaling an image.",
	RI: "Rendering intent in extended graphics state.",
	ca: "Nonstroking opacity.",
	CA: "Stroking opacity.",
	OP: "Stroking overprint.",
	op: "Nonstroking overprint.",
	OPM: "CMYK overprint mode.",
}
export const operationExplanations: Readonly<Record<string, string>> = {
	q: "Save the graphics state, including the current transformation, colors, and clipping path. Q restores it.",
	Q: "Restore the most recently saved graphics state. This prevents one placement’s transformations and colors from affecting later drawing.",
	cm: "Concatenate a transformation matrix. The six operands scale, rotate, shear, or translate subsequent drawing in the current coordinate system.",
	Do: "Paint the named image or Form XObject from /Resources/XObject. The same resource can be painted many times using different transformations. Direct page images are outlined in the preview before clipping.",
	Tf: "Select a font from /Resources/Font and set its size. The resource name is local to this drawing context.",
	BT: "Begin a text object. Text operators inside it position and paint glyphs.",
	ET: "End the text object.",
	Tm: "Set the text matrix, determining where text is placed and how it is transformed.",
	Tj: "Show the string’s glyphs using the selected font, text matrix, and text rendering mode.",
	TJ: "Show an array of strings and spacing adjustments using the current text state.",
	rg: "Set the nonstroking DeviceRGB color. This affects later fills and text painting, rather than painting immediately.",
	RG: "Set the stroking DeviceRGB color for later strokes.",
	re: "Append a rectangle to the current path: x, y, width, and height. A later painting operator makes it visible.",
	f: "Fill the current path with the current nonstroking color using the nonzero winding rule.",
	S: "Stroke the current path using the current stroke color, line width, and other stroke settings.",
	W: "Set the clipping path from the current path using the nonzero winding rule, after the path-ending operator. Image outlines may extend beyond this clip.",
	n: "End the current path without painting it, applying any pending clipping operation.",
}
