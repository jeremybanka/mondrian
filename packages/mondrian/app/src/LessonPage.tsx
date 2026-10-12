import { useO } from "atom.io/react"

import { chapters } from "./chapters.ts"
import { DrawingLab } from "./DrawingLab.tsx"
import { FileExplorer } from "./FileExplorer.tsx"
import css from "./LessonPage.module.css"
import { ObjectExplorer } from "./ObjectExplorer.tsx"
import { PdfPortrait } from "./PdfPortrait.tsx"
import type { ChapterId } from "./router.ts"
import { chapterHref } from "./router.ts"
import { downloadSpecimen, specimenBytes } from "./specimen.ts"
import { drawingXAtom } from "./state.ts"

const builderCode = `import { createPdfDocument, parsePdf, validatePdf }
  from "mondrian.pdf"

const pdf = createPdfDocument()
const helvetica = pdf.standardFont("Helvetica")

const page = pdf.page({
  mediaBox: [0, 0, 300, 360],
  content: [
    pdf.text(text => text
      .font(helvetica, 16)
      .moveText(48, 64)
      .show("Hello, PDF.")),
  ],
})
pdf.setPages(page)

const model = pdf.compile()        // PdfDocument
const bytes = pdf.serialize()      // Uint8Array
const parsed = parsePdf(bytes)     // PdfDocument
const diagnostics = validatePdf(parsed)`

const colorCode = `// Caller-supplied image and ICC profile bytes:
const pdf = createPdfDocument({
  blendingSpace: { rgbProfile: sourceRgbProfile },
  outputIntent: {
    profile: pressCmykProfile,
    identifier: "Chosen printing condition",
  },
})

const photograph = pdf.rgbImage(prepareRgbImage(imageBytes, {
  sourceProfile: sourceRgbProfile,
}))

pdf.setPages(pdf.page({
  mediaBox: [0, 0, 300, 360],
  content: [pdf.graphics(g =>
    g.drawImage(photograph, 30, 30, 240, 300))],
}))

// Explicit conversion for that destination, rather than metadata alone:
const prepared = await preparePdfForPrint(pdf.compile(), {
  destinationProfile: pressCmykProfile,
  outputCondition: "Chosen printing condition",
  renderingIntent: "relative-colorimetric",
  objectIntents: "honor",
  blackPointCompensation: true,
  untaggedRgb: "reject",
  gray: "black-only",
  spots: "preserve",
  processNumbers: "preserve",
  blending: "destination",
})
const bytes = serializePdf(prepared.document)`

export function LessonPage({ chapter }: { chapter: ChapterId }) {
	const index = chapters.findIndex((entry) => entry.id === chapter)
	const lesson = chapters[index]!
	const next = chapters[index + 1]
	const previous = chapters[index - 1]
	const x = useO(drawingXAtom)

	return (
		<lesson-page className={css.class} data-chapter={chapter}>
			<article>
				<lesson-topline>
					<span>THE PDF FIELD GUIDE</span>
					<span>
						CHAPTER {String(index + 1).padStart(2, "0")} <i /> {lesson.time}{" "}
						read
					</span>
				</lesson-topline>
				<section id="idea" data-introduction>
					<intro-layout>
						<intro-copy>
							<small>
								<i />{" "}
								{chapter === "overview"
									? "A LOOK BENEATH THE PAGE"
									: lesson.short.toUpperCase()}
							</small>
							<h1>
								{chapter === "overview" ? (
									<>
										How does a<br />
										<em>PDF</em> work?
									</>
								) : (
									lesson.heading
								)}
							</h1>
							<p>{lesson.intro}</p>
							{chapter === "overview" && (
								<a href="/anatomy" data-primary>
									Open up the format <span aria-hidden="true">↗</span>
								</a>
							)}
							{chapter === "overview" && (
								<intro-meta>
									<span>6 short chapters</span>
									<i />
									<span>About 17 minutes</span>
									<i />
									<span>Made with Mondrian</span>
								</intro-meta>
							)}
						</intro-copy>
						{chapter === "overview" && <PdfPortrait />}
					</intro-layout>
					{chapter === "overview" && (
						<concept-strip>
							<concept-note>
								<span>01 / STRUCTURE</span>
								<h3>A graph of objects.</h3>
								<p>
									The catalog, pages, fonts, and content connect through
									references.
								</p>
							</concept-note>
							<concept-note>
								<span>02 / INSTRUCTIONS</span>
								<h3>A program for a page.</h3>
								<p>
									Small drawing commands tell the reader what to paint and
									where.
								</p>
							</concept-note>
							<concept-note>
								<span>03 / REPRESENTATION</span>
								<h3>A typed model.</h3>
								<p>
									Mondrian turns PDF values and relationships into TypeScript.
								</p>
							</concept-note>
						</concept-strip>
					)}
					{chapter === "anatomy" && (
						<prose-block>
							<h2>Start at the end.</h2>
							<p>
								A conventional PDF has a header, indirect objects, a
								cross-reference table, a trailer dictionary, and a file ending.
								Readers use <code>startxref</code> near the end to find the
								cross-reference section, then follow the trailer’s{" "}
								<code>/Root</code> to the catalog.
							</p>
							<p>
								The cross-reference table is an index, not the document itself.
								It tells the reader exactly where an object starts, without
								scanning every byte before it.
							</p>
						</prose-block>
					)}
					{chapter === "objects" && (
						<prose-block>
							<h2>Learn the vocabulary.</h2>
							<p>
								A slash introduces a <em>name</em>; parentheses delimit a{" "}
								<em>byte string</em>. They serve different purposes.
								Dictionaries associate name keys with values, while arrays hold
								ordered values.
							</p>
							<table>
								<caption>PDF syntax and Mondrian helpers</caption>
								<thead>
									<tr>
										<th>PDF value</th>
										<th>On disk</th>
										<th>In Mondrian</th>
									</tr>
								</thead>
								<tbody>
									<tr>
										<td>Simple values</td>
										<td>
											<code>true · 42 · null</code>
										</td>
										<td>
											<code>true · 42 · null</code>
										</td>
									</tr>
									<tr>
										<td>Name</td>
										<td>
											<code>/Page</code>
										</td>
										<td>
											<code>name("Page")</code>
										</td>
									</tr>
									<tr>
										<td>Literal string</td>
										<td>
											<code>(Hello)</code>
										</td>
										<td>
											<code>literalString(ascii("Hello"))</code>
										</td>
									</tr>
									<tr>
										<td>Hex string</td>
										<td>
											<code>&lt;4869&gt;</code>
										</td>
										<td>
											<code>hexString(ascii("Hi"))</code>
										</td>
									</tr>
									<tr>
										<td>Array</td>
										<td>
											<code>[0 0 300 360]</code>
										</td>
										<td>
											<code>array(0, 0, 300, 360)</code>
										</td>
									</tr>
									<tr>
										<td>Dictionary</td>
										<td>
											<code>&lt;&lt; /Type /Page &gt;&gt;</code>
										</td>
										<td>
											<code>dictionary({`{ Type: name("Page") }`})</code>
										</td>
									</tr>
									<tr>
										<td>Reference</td>
										<td>
											<code>3 0 R</code>
										</td>
										<td>
											<code>reference(3)</code>
										</td>
									</tr>
								</tbody>
							</table>
							<p>
								Mondrian uses native JavaScript values for numbers, booleans,
								and null. Structured values carry a <code>kind</code>{" "}
								discriminator. Strings and stream data preserve bytes in{" "}
								<code>Uint8Array</code>; text encoding is a separate concern.
							</p>
						</prose-block>
					)}
					{chapter === "pages" && (
						<prose-block>
							<h2>A tree inside a graph.</h2>
							<p>
								The <code>/Catalog</code> points to a <code>/Pages</code> node.
								Each <code>/Pages</code> dictionary has <code>/Kids</code> and a
								descendant-page <code>/Count</code>. A child can be another
								branch or a leaf <code>/Page</code>.
							</p>
							<p>
								A page’s <code>/MediaBox</code> describes its physical extent.{" "}
								<code>/Contents</code> points to a stream or array of streams;{" "}
								<code>/Resources</code> supplies fonts, images, and other
								objects needed by the program. The <code>/Parent</code>{" "}
								reference leads back up the tree.
							</p>
						</prose-block>
					)}
					{chapter === "drawing" && (
						<prose-block>
							<h2>Operands first. Operator last.</h2>
							<p>
								<code>48 152 120 120 re</code> means “append a rectangle at (48,
								152), 120 units wide and 120 units high.” The following{" "}
								<code>f</code> fills it. Changing the color or defining the path
								alone paints nothing.
							</p>
							<p>
								For this unrotated page, the origin is at the bottom left and y
								increases upward. A default user-space unit is 1/72 inch. Page
								boxes, rotation, <code>/UserUnit</code>, and transformation
								matrices can change that setup.
							</p>
						</prose-block>
					)}
					{chapter === "mondrian" && (
						<prose-block>
							<h2>Choose your level of control.</h2>
							<api-layers>
								<api-layer>
									<span>AUTHORING</span>
									<h3>Semantic builder</h3>
									<p>
										<code>createPdfDocument()</code> owns the page tree and
										resource handles. It derives parents, counts, and resource
										names, and scopes text and graphics operations.
									</p>
								</api-layer>
								<api-layer>
									<span>STRUCTURE</span>
									<h3>Object model & builder</h3>
									<p>
										<code>PdfDocument</code> exposes the graph.{" "}
										<code>createPdfObjectBuilder()</code> manages indirect
										objects when you need to author names, arrays, dictionaries,
										and streams directly.
									</p>
								</api-layer>
							</api-layers>
							<p>
								Both paths produce a <code>PdfDocument</code>: a version, a
								catalog reference in <code>root</code>, and an array of indirect{" "}
								<code>objects</code>, plus optional metadata and IDs. It’s a
								format-level model, not a browser DOM or a layout engine.
							</p>
						</prose-block>
					)}
				</section>
				<section id="explore" data-exploration>
					<section-heading>
						<heading-copy>
							<small>
								{chapter === "overview"
									? "LET’S MAKE IT CONCRETE"
									: "LEARN BY EXPLORING"}
							</small>
							<h2>
								{chapter === "overview"
									? "One tiny PDF. The whole idea."
									: chapter === "anatomy"
										? "Read the actual bytes."
										: chapter === "objects"
											? "Same object. Two representations."
											: chapter === "pages"
												? "Walk the document graph."
												: chapter === "drawing"
													? "Give the reader instructions."
													: "Author. Compile. Serialize. Parse."}
							</h2>
						</heading-copy>
						<span aria-hidden="true">↘</span>
					</section-heading>
					{chapter === "overview" && (
						<>
							<p>
								Our specimen contains one square and one line of text. Behind
								that modest page are five indirect objects. Select one, then
								switch between its PDF syntax and Mondrian’s representation.
							</p>
							<ObjectExplorer />
						</>
					)}
					{chapter === "anatomy" && <FileExplorer />}
					{(chapter === "objects" || chapter === "pages") && <ObjectExplorer />}
					{chapter === "drawing" && <DrawingLab />}
					{chapter === "mondrian" && (
						<>
							<p>
								This semantic example creates the text-only version of our page.
								The guide’s downloadable specimen uses the low-level object
								model and adds the square.
							</p>
							<pre data-example>
								<code>{builderCode}</code>
							</pre>
							<journey-strip>
								<journey-stage>
									<span>01</span>
									<strong>Author</strong>
									<code>builder</code>
								</journey-stage>
								<span>→</span>
								<journey-stage>
									<span>02</span>
									<strong>Compile</strong>
									<code>PdfDocument</code>
								</journey-stage>
								<span>→</span>
								<journey-stage>
									<span>03</span>
									<strong>Serialize</strong>
									<code>Uint8Array</code>
								</journey-stage>
								<span>→</span>
								<journey-stage>
									<span>04</span>
									<strong>Parse</strong>
									<code>PdfDocument</code>
								</journey-stage>
							</journey-strip>
							<p>
								<code>serializePdf()</code> validates the graph, sorts indirect
								objects by number, computes stream lengths and byte offsets, and
								writes a classic cross-reference table. The semantic builder’s{" "}
								<code>serialize()</code> combines compilation and serialization.
							</p>
						</>
					)}
					<specimen-download>
						<download-copy>
							<span aria-hidden="true">↓</span>
							<p>
								<strong>Take the specimen with you.</strong>
								<small>
									A real PDF, generated by Mondrian · {specimenBytes(x).length}{" "}
									bytes
								</small>
							</p>
						</download-copy>
						<button type="button" onClick={() => downloadSpecimen(x)}>
							Download PDF <span aria-hidden="true">↗</span>
						</button>
					</specimen-download>
				</section>
				{chapter === "mondrian" && (
					<section id="color" data-exploration>
						<section-heading>
							<heading-copy>
								<small>BEYOND THE LITTLE SQUARE</small>
								<h2>Color has a source and a destination.</h2>
							</heading-copy>
							<span aria-hidden="true">↘</span>
						</section-heading>
						<p>
							A PDF can combine RGB photographs, native CMYK paint, and named
							spot inks. A tagged RGB image’s <code>/ColorSpace</code> contains
							an <code>/ICCBased</code> array that references an ICC profile
							stream with <code>/N 3</code>. Its pixels and profile are separate
							objects; optional alpha becomes a grayscale image referenced by{" "}
							<code>/SMask</code>. Mondrian’s <code>rgbImage()</code> builds
							those connections from typed RGB data and source profile bytes.
						</p>
						<p>
							The source profile describes the image’s color. The catalog’s{" "}
							<code>/OutputIntents</code> describes a destination printing
							condition. Attaching an OutputIntent does not convert RGB samples
							to CMYK or establish PDF/X conformance. Transparency adds another
							choice: the page’s <code>/Group /CS</code> determines its blending
							space. For transparent RGB authoring, Mondrian requires an
							explicit <code>blendingSpace</code>; a CMYK OutputIntent supplies
							a default DeviceCMYK blending space when no override is given.
						</p>
						<p>
							<code>prepareRgbImage()</code> and{" "}
							<code>preparePdfForPrint()</code> come from{" "}
							<code>mondrian.pdf/print</code>. The first decodes an image
							without converting its color; the second prepares a supported
							object graph for a caller-selected CMYK condition. This sketch
							uses caller-supplied image bytes and verified ICC profiles, with{" "}
							<code>createPdfDocument</code> and <code>serializePdf</code>{" "}
							imported from <code>mondrian.pdf</code>.
						</p>
						<pre data-example>
							<code>{colorCode}</code>
						</pre>
						<p>
							Preparation can preserve live text, vectors, dimensions, alpha,
							K-only process paint, and named <code>/Separation</code> inks, and
							returns a conversion report. The policies are explicit: decide how
							to interpret untagged RGB and gray, whether to preserve CMYK
							numbers, and which rendering intents to honor. Conversion resolves
							vector and text color at painting time, using the active intent
							and scoped graphics state.
						</p>
						<p>
							<code>blending: "destination"</code> converts each source color
							before blending destination ink amounts. That can differ from
							blending RGB first and converting the composite. With an RGB page
							group, <code>blending: "preserve-source"</code> rejects
							preparation explicitly: preserving that source blending order is
							still unsupported. The{" "}
							<a
								href="https://github.com/jeremybanka/mondrian/blob/main/packages/mondrian/docs/mixed-color-print.md"
								target="_blank"
								rel="noreferrer"
							>
								mixed-color print guide ↗
							</a>{" "}
							covers the policies, plate extraction, and supported limits.
						</p>
					</section>
				)}
				<section id="takeaway" data-takeaway>
					<small>THE THING TO REMEMBER</small>
					{chapter === "overview" && (
						<>
							<h2>A PDF is a graph that knows how to paint.</h2>
							<p>
								The file stores the graph. The reader follows its references and
								executes its content streams. Mondrian gives you typed tools to
								build, inspect, validate, and serialize that structure.
							</p>
						</>
					)}
					{chapter === "anatomy" && (
						<>
							<h2>The index can change. The idea stays.</h2>
							<p>
								PDF 1.5 introduced cross-reference streams and compressed object
								streams. Incremental updates append new revisions and link back
								with <code>/Prev</code>. Mondrian’s parser resolves supported
								input structures into a single object graph; serializing it
								writes a fresh file with a classic cross-reference table, not a
								byte-for-byte reproduction of the original revisions.
							</p>
						</>
					)}
					{chapter === "objects" && (
						<>
							<h2>A reference is an identity, not an address.</h2>
							<p>
								<code>3 0 R</code> names object 3, generation 0. The
								cross-reference section supplies its byte location. In Mondrian,{" "}
								<code>PdfReference</code> keeps the object number and
								generation, and <code>PdfIndirectObject</code> pairs that
								identity with its value. Streams are indirect objects; a
								reference lets a dictionary point to one.
							</p>
						</>
					)}
					{chapter === "pages" && (
						<>
							<h2>The builder owns the bookkeeping.</h2>
							<p>
								Some page attributes, including <code>/MediaBox</code> and{" "}
								<code>/Resources</code>, can be inherited from ancestors. With
								Mondrian’s semantic API, use{" "}
								<code>
									pdf.setPages(pdf.pages(cover, pdf.pages(pageOne, pageTwo)))
								</code>
								. It derives the parent links and descendant counts, and
								discovers the resources used by your content.
							</p>
						</>
					)}
					{chapter === "drawing" && (
						<>
							<h2>The program needs its resources.</h2>
							<p>
								<code>/F1 16 Tf</code> selects a font from the page’s resource
								dictionary. <code>Tj</code> shows encoded glyphs; it doesn’t
								simply render arbitrary Unicode. Mondrian’s semantic text API
								creates resource names from owned font handles. In a raw stream,
								you must make the commands and resource dictionary agree. This
								diagram illustrates the commands; the downloaded PDF is the
								actual output.
							</p>
						</>
					)}
					{chapter === "mondrian" && (
						<>
							<h2>Keep the structure in sight.</h2>
							<p>
								<code>validatePdf()</code> reports structural diagnostics, and{" "}
								<code>parsePdf()</code> reads supported PDF inputs into the same
								model. Parsing preserves content-stream bytes; it does not turn
								drawing operators into a layout tree. Validation checks
								Mondrian’s invariants rather than certifying every PDF standard
								or guaranteeing a renderer’s appearance.
							</p>
							<resource-links>
								<a
									href="https://github.com/jeremybanka/mondrian/tree/main/packages/mondrian"
									target="_blank"
									rel="noreferrer"
								>
									Mondrian’s API guide ↗
								</a>
								<a
									href="https://pdfa.org/resource/pdf-specification-archive/"
									target="_blank"
									rel="noreferrer"
								>
									The PDF specifications ↗
								</a>
							</resource-links>
						</>
					)}
				</section>
				<nav aria-label="Chapter navigation" data-pagination>
					{previous ? (
						<a href={chapterHref(previous.id)}>
							<small>← PREVIOUS CHAPTER</small>
							<strong>{previous.title}</strong>
						</a>
					) : (
						<nav-introduction>
							<small>START WITH CURIOSITY.</small>
							<strong>Leave with a mental model.</strong>
						</nav-introduction>
					)}
					{next ? (
						<a href={chapterHref(next.id)} data-next>
							<small>UP NEXT / {String(index + 2).padStart(2, "0")}</small>
							<strong>
								{next.title} <span aria-hidden="true">→</span>
							</strong>
						</a>
					) : (
						<a href="/" data-next>
							<small>BACK TO THE BEGINNING</small>
							<strong>
								See the big picture <span aria-hidden="true">↗</span>
							</strong>
						</a>
					)}
				</nav>
			</article>
			<guide-footer>
				<span>
					mondrian <i /> A little clarity, one object at a time.
				</span>
				<a
					href="https://github.com/jeremybanka/mondrian"
					target="_blank"
					rel="noreferrer"
				>
					Open source. Open format. ↗
				</a>
			</guide-footer>
		</lesson-page>
	)
}
