import type { ChapterId } from "./router.ts"

export const chapters = [
	{
		id: "overview",
		title: "The big picture",
		short: "A document, underneath",
		time: "2 min",
		heading: "How does a PDF work?",
		intro:
			"A page on the outside. A small universe of objects on the inside. Let’s open one up—and see how Mondrian gives that universe a shape in TypeScript.",
		sections: [
			{ id: "idea", label: "The mental model" },
			{ id: "explore", label: "Meet our specimen" },
			{ id: "takeaway", label: "What to remember" },
		],
	},
	{
		id: "anatomy",
		title: "Anatomy of a file",
		short: "From the first byte to EOF",
		time: "3 min",
		heading: "A file with an address book.",
		intro:
			"A PDF is a sequence of bytes with a way to find its objects. The cross-reference section connects an object’s identity to its location in the file.",
		sections: [
			{ id: "idea", label: "Five parts of a PDF" },
			{ id: "explore", label: "Explore the bytes" },
			{ id: "takeaway", label: "Beyond the simple file" },
		],
	},
	{
		id: "objects",
		title: "Objects & references",
		short: "The vocabulary of PDF",
		time: "3 min",
		heading: "Small values. Connected ideas.",
		intro:
			"Numbers, names, strings, arrays, and dictionaries form PDF’s vocabulary. Indirect references connect those values into a document graph.",
		sections: [
			{ id: "idea", label: "The building blocks" },
			{ id: "explore", label: "Syntax ↔ Mondrian" },
			{ id: "takeaway", label: "Identity versus location" },
		],
	},
	{
		id: "pages",
		title: "The page tree",
		short: "Finding your way to a page",
		time: "2 min",
		heading: "Follow the references.",
		intro:
			"The catalog points to a page tree. The tree leads to pages. Each page tells the reader where to find its drawing instructions and the resources they use.",
		sections: [
			{ id: "idea", label: "From catalog to content" },
			{ id: "explore", label: "Walk the graph" },
			{ id: "takeaway", label: "What the builder owns" },
		],
	},
	{
		id: "drawing",
		title: "Drawing a page",
		short: "A little program for the reader",
		time: "3 min",
		heading: "The page is a program.",
		intro:
			"A content stream is an ordered sequence of operands and operators. The reader executes them to paint paths, place glyphs, and draw images.",
		sections: [
			{ id: "idea", label: "Coordinates & commands" },
			{ id: "explore", label: "Step through a stream" },
			{ id: "takeaway", label: "Resources make it work" },
		],
	},
	{
		id: "mondrian",
		title: "Thinking in Mondrian",
		short: "From TypeScript to bytes",
		time: "3 min",
		heading: "Give the format a type.",
		intro:
			"Mondrian keeps the PDF structure visible. Use its semantic builder to author documents, or its object model when you want direct control over the graph.",
		sections: [
			{ id: "idea", label: "Two ways to author" },
			{ id: "explore", label: "The complete journey" },
			{ id: "takeaway", label: "Keep exploring" },
		],
	},
] as const satisfies readonly {
	id: ChapterId
	title: string
	short: string
	time: string
	heading: string
	intro: string
	sections: readonly { id: string; label: string }[]
}[]

export const objectDetails = [
	{
		id: 1,
		label: "Catalog",
		type: "dictionary",
		note: "The document’s front door. /Type /Catalog identifies its role; /Pages 2 0 R points to the page-tree root.",
		helper: 'dictionary({ Type: name("Catalog"),\n  Pages: reference(2) })',
	},
	{
		id: 2,
		label: "Pages",
		type: "dictionary",
		note: "A page-tree node. /Kids lists its immediate children; /Count counts all descendant pages, not just direct children.",
		helper:
			'dictionary({ Type: name("Pages"),\n  Kids: array(reference(3)), Count: 1 })',
	},
	{
		id: 3,
		label: "Page",
		type: "dictionary",
		note: "Our single page. /Parent links back to the tree; /MediaBox sets its extent. /Contents and /Resources connect the page to its program and font.",
		helper:
			'dictionary({ Type: name("Page"),\n  Parent: reference(2),\n  MediaBox: array(0, 0, 300, 360),\n  Resources: dictionary({ Font:\n    dictionary({ F1: reference(5) }) }),\n  Contents: reference(4) })',
	},
	{
		id: 4,
		label: "Content",
		type: "stream",
		note: "A dictionary plus raw bytes. Here the bytes are uncompressed drawing commands. Mondrian derives /Length from data.length during serialization.",
		helper:
			'stream({}, ascii("q\\n0.76 0.73 0.91 rg\\n48 152 120 120 re\\nf\\nQ\\n…"))',
	},
	{
		id: 5,
		label: "Font",
		type: "dictionary",
		note: "The page’s /F1 resource refers to a standard Helvetica font. /F1 is a local resource name, not a globally meaningful font name.",
		helper:
			'dictionary({ Type: name("Font"),\n  Subtype: name("Type1"),\n  BaseFont: name("Helvetica") })',
	},
] as const
