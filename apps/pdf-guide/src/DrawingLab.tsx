import { scaleLinear } from "@visx/scale"
import { LinePath } from "@visx/shape"
import { useI, useO } from "atom.io/react"

import css from "./DrawingLab.module.css"
import { drawingCommands } from "./specimen.ts"
import { drawingStepAtom, drawingXAtom } from "./state.ts"

const explanations = [
	"q saves the current graphics state so our color choice stays local.",
	"rg sets the nonstroking RGB color. It changes the state; nothing is painted yet.",
	"re appends a rectangle to the current path: x, y, width, height. The dashed outline is our teaching overlay.",
	"f fills the path with the current color and clears the path. Now the square is visible.",
	"Q restores the saved graphics state. The painted square remains on the page.",
	"BT begins a text object. Text placement uses its own matrices within page space.",
	"Tf chooses the page’s /F1 font resource at a size of 16 user-space units.",
	"Td moves the text position 48 units right and 64 units up from the text object’s origin.",
	"Tj shows the string’s glyphs. These bytes use our standard Helvetica font’s encoding.",
	"ET ends the text object. Our tiny page program is complete.",
]

export function DrawingLab() {
	const x = useO(drawingXAtom)
	const setX = useI(drawingXAtom)
	const step = useO(drawingStepAtom)
	const setStep = useI(drawingStepAtom)
	const sx = scaleLinear({ domain: [0, 300], range: [36, 286] })
	const sy = scaleLinear({ domain: [0, 360], range: [324, 24] })
	return (
		<drawing-lab className={css.class}>
			<lab-heading>
				<span>THE CONTENT STREAM, IN MOTION</span>
				<small>300 × 360 pt · unrotated page</small>
			</lab-heading>
			<lab-panels>
				<program-panel>
					<ol aria-label="Drawing commands">
						{drawingCommands(x).map((command, index) => (
							<li
								key={index}
								data-active={index === step}
								data-done={index < step}
							>
								<button
									type="button"
									aria-label={`Execute through command ${index + 1}: ${command}`}
									aria-current={index === step ? "step" : undefined}
									onClick={() => setStep(index)}
								>
									<span>{String(index + 1).padStart(2, "0")}</span>
									<code>{command}</code>
									<span aria-hidden="true">{index === step ? "←" : ""}</span>
								</button>
							</li>
						))}
					</ol>
					<step-controls>
						<button
							type="button"
							onClick={() => setStep(Math.max(0, step - 1))}
							disabled={step === 0}
						>
							← Previous
						</button>
						<span>{step + 1} / 10</span>
						<button
							type="button"
							onClick={() => setStep(Math.min(9, step + 1))}
							disabled={step === 9}
						>
							Next →
						</button>
					</step-controls>
				</program-panel>
				<canvas-panel>
					<svg
						viewBox="0 0 325 355"
						role="img"
						aria-label={`PDF coordinate diagram at command ${step + 1}. Rectangle x position ${x}, y position 152. ${step >= 3 ? "Rectangle filled." : "Rectangle not yet painted."} ${step >= 8 ? "Hello, PDF text visible." : "Text not yet painted."}`}
					>
						<rect
							x="36"
							y="24"
							width="250"
							height="300"
							fill="#fffefa"
							stroke="#d4d0c6"
						/>
						<LinePath
							data={[
								[36, 16],
								[36, 324],
								[301, 324],
							]}
							x={(d) => d[0] ?? 0}
							y={(d) => d[1] ?? 0}
							stroke="#a3a099"
							strokeWidth={1}
						/>
						<text x="16" y="19" fontSize="9" fill="#96918c">
							y ↑
						</text>
						<text x="294" y="342" fontSize="9" fill="#96918c">
							x →
						</text>
						<text x="16" y="341" fontSize="8" fill="#96918c">
							0, 0
						</text>
						{[72, 144, 216, 288].map((value) => (
							<g key={value}>
								<line
									x1="33"
									x2="39"
									y1={sy(value)}
									y2={sy(value)}
									stroke="#bbb7ad"
								/>
								<text x="10" y={sy(value) + 3} fontSize="7" fill="#96918c">
									{value}
								</text>
							</g>
						))}
						{step >= 2 && (
							<rect
								x={sx(x)}
								y={sy(272)}
								width={100}
								height={100}
								fill={step >= 3 ? "rgb(76% 73% 91%)" : "none"}
								stroke={step === 2 ? "#8f7dad" : "none"}
								strokeDasharray="4 4"
							/>
						)}
						{step >= 8 && (
							<text
								x={sx(48)}
								y={sy(64)}
								fontSize={(16 * 250) / 300}
								fill="black"
								fontFamily="Helvetica, sans-serif"
							>
								Hello, PDF.
							</text>
						)}
					</svg>
					<label htmlFor="rectangle-x">
						Move the rectangle <output>{x} pt</output>
					</label>
					<input
						id="rectangle-x"
						type="range"
						min="12"
						max="168"
						value={x}
						onChange={(event) => setX(Number(event.target.value))}
					/>
				</canvas-panel>
			</lab-panels>
			<lab-explanation aria-live="polite">
				<strong>{drawingCommands(x)[step]?.split(" ").at(-1)}</strong>
				<p>{explanations[step]}</p>
			</lab-explanation>
		</drawing-lab>
	)
}
