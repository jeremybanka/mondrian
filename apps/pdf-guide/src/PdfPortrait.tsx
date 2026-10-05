import { useO } from "atom.io/react"
import { LinePath } from "@visx/shape"
import { scaleLinear } from "@visx/scale"
import { drawingXAtom } from "./state.ts"
import css from "./PdfPortrait.module.css"

export function PdfPortrait() {
	const x = useO(drawingXAtom)
	const frame = scaleLinear({ domain: [0, 300], range: [48, 298] })
	return (
		<pdf-portrait className={css.class}>
			<figure>
				<svg
					viewBox="0 0 470 420"
					role="img"
					aria-label="A PDF page connected to its numbered content, page, and font objects"
				>
					<defs>
						<pattern
							id="portrait-grid"
							width="20"
							height="20"
							patternUnits="userSpaceOnUse"
						>
							<circle cx="1" cy="1" r=".75" fill="#d3d0c9" />
						</pattern>
					</defs>
					<rect width="470" height="420" fill="url(#portrait-grid)" />
					<g transform="rotate(-7 176 198)">
						<rect
							x="59"
							y="40"
							width="250"
							height="300"
							rx="2"
							fill="#dedbd3"
						/>
						<rect
							x="48"
							y="28"
							width="250"
							height="300"
							rx="2"
							fill="#fffefa"
							stroke="#d3cfc5"
						/>
						<rect
							x={frame(x)}
							y="101"
							width="100"
							height="100"
							fill="#c2bae8"
						/>
						<text
							x="88"
							y="275"
							fontSize="14"
							fill="#292b3c"
							fontFamily="Helvetica, sans-serif"
						>
							Hello, PDF.
						</text>
						<text x="69" y="51" fontSize="7" fill="#93908b" letterSpacing="1.2">
							ONE PAGE. FIVE OBJECTS.
						</text>
					</g>
					<LinePath
						data={[
							[219, 141],
							[340, 107],
							[365, 107],
						]}
						x={(d) => d[0] ?? 0}
						y={(d) => d[1] ?? 0}
						stroke="#9681b8"
						strokeWidth="1.3"
						strokeDasharray="4 4"
					/>
					<LinePath
						data={[
							[288, 260],
							[326, 248],
							[356, 248],
						]}
						x={(d) => d[0] ?? 0}
						y={(d) => d[1] ?? 0}
						stroke="#b5a778"
						strokeWidth="1.3"
						strokeDasharray="4 4"
					/>
					<rect
						x="338"
						y="73"
						width="110"
						height="61"
						rx="5"
						fill="#eeebf7"
						stroke="#c9c0df"
					/>
					<text
						x="350"
						y="95"
						fontSize="10"
						fill="#706184"
						fontFamily="monospace"
					>
						4 0 obj
					</text>
					<text x="350" y="117" fontSize="12" fill="#292b3c">
						Content stream
					</text>
					<rect
						x="330"
						y="221"
						width="118"
						height="61"
						rx="5"
						fill="#f1ebda"
						stroke="#d9cfae"
					/>
					<text
						x="342"
						y="243"
						fontSize="10"
						fill="#82764e"
						fontFamily="monospace"
					>
						3 0 obj
					</text>
					<text x="342" y="265" fontSize="12" fill="#292b3c">
						Page dictionary
					</text>
					<g transform="rotate(5 168 346)">
						<rect
							x="102"
							y="321"
							width="159"
							height="63"
							rx="4"
							fill="#292b3c"
						/>
						<text
							x="118"
							y="344"
							fontSize="9"
							fill="#c2bae8"
							fontFamily="monospace"
						>
							5 0 obj
						</text>
						<text x="118" y="368" fontSize="16" fill="#f7f6f2">
							Aa <tspan fontSize="11">Helvetica</tspan>
						</text>
					</g>
				</svg>
				<figcaption>
					<span>FIG. 01</span> A page is only the beginning.
				</figcaption>
			</figure>
		</pdf-portrait>
	)
}
