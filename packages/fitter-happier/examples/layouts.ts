import { box, image, type LayoutNode, text } from "fitter-happier"
import { sampleJpegDataUrl } from "./assets.ts"

export type LayoutFixtureSlug =
	| "split-layout-specimen"
	| "portrait-layout-study"
	| "fitter-happier-type-specimen"
	| "jpeg-contact-sheet"
	| "nested-coordinate-lab"
	| "overflow-clip-lab"

export interface LayoutFixture {
	readonly slug: LayoutFixtureSlug
	readonly description: string
	readonly width: number
	readonly height: number
	readonly node: LayoutNode
}

const splitLayoutSpecimenWidth = 420
const splitLayoutSpecimenHeight = 640

export const splitLayoutSpecimen: LayoutFixture = {
	slug: "split-layout-specimen",
	description:
		"A warm split layout with nested cards, borders, and aligned multiline copy.",
	width: splitLayoutSpecimenWidth,
	height: splitLayoutSpecimenHeight,
	node: box({
		id: "split-layout-specimen",
		style: {
			width: splitLayoutSpecimenWidth,
			height: splitLayoutSpecimenHeight,
			padding: 28,
			gap: 18,
			backgroundColor: "#fffdf8",
			flexDirection: "column",
			overflow: "hidden",
		},
		children: [
			box({
				id: "split-layout-header",
				style: {
					height: 64,
					paddingLeft: 16,
					paddingRight: 16,
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "space-between",
					backgroundColor: "#f8fafc",
					borderWidth: 1,
					borderColor: "#d1d5db",
					borderRadius: 8,
				},
				children: [
					text({
						id: "split-layout-title",
						text: "Layout Specimen",
						style: {
							width: 204,
							height: 28,
							fontFamily: "Helvetica",
							fontSize: 22,
							fontWeight: 700,
							lineHeight: 28,
							color: "#111827",
						},
					}),
					text({
						id: "split-layout-sample-number",
						text: "SAMPLE 0042",
						style: {
							width: 112,
							height: 16,
							fontFamily: "Courier",
							fontSize: 11,
							lineHeight: 16,
							textAlign: "right",
							color: "#475569",
						},
					}),
				],
			}),
			box({
				id: "split-layout-body",
				style: {
					flexGrow: 1,
					flexShrink: 1,
					flexDirection: "row",
					gap: 18,
				},
				children: [
					box({
						id: "split-layout-preview-well",
						style: {
							flexGrow: 1,
							flexShrink: 1,
							padding: 18,
							gap: 14,
							flexDirection: "column",
							alignItems: "center",
							justifyContent: "center",
							backgroundColor: "#eff6ff",
							borderWidth: 2,
							borderColor: "#2563eb",
							borderRadius: 8,
						},
						children: [
							box({
								id: "split-layout-preview-mark",
								style: {
									width: 112,
									height: 142,
									alignItems: "center",
									justifyContent: "center",
									backgroundColor: "#bfdbfe",
									borderWidth: 2,
									borderColor: "#1d4ed8",
									borderRadius: 8,
								},
								children: [
									text({
										id: "split-layout-preview-mark-label",
										text: "PDF",
										style: {
											width: 84,
											height: 40,
											fontSize: 34,
											fontWeight: 700,
											lineHeight: 40,
											textAlign: "center",
											color: "#1d4ed8",
										},
									}),
								],
							}),
							text({
								id: "split-layout-preview-copy",
								text: "Centered layout\nkeeps its rhythm",
								style: {
									width: 164,
									height: 48,
									fontSize: 18,
									lineHeight: 24,
									textAlign: "center",
									color: "#1d4ed8",
								},
							}),
							box({
								id: "split-layout-capability-row",
								style: {
									width: 188,
									height: 28,
									flexDirection: "row",
									gap: 8,
								},
								children: ["TYPE", "BOX", "PDF"].map((label) =>
									box({
										id: `split-layout-capability-${label.toLowerCase()}`,
										style: {
											flexGrow: 1,
											alignItems: "center",
											justifyContent: "center",
											backgroundColor: "#dbeafe",
											borderWidth: 1,
											borderColor: "#93c5fd",
											borderRadius: 4,
										},
										children: [
											text({
												id: `split-layout-capability-${label.toLowerCase()}-label`,
												text: label,
												style: {
													width: 52,
													height: 12,
													fontFamily: "Courier",
													fontSize: 9,
													fontWeight: 700,
													lineHeight: 12,
													textAlign: "center",
													color: "#1e40af",
												},
											}),
										],
									}),
								),
							}),
						],
					}),
					box({
						id: "split-layout-side-panel",
						style: {
							width: 132,
							flexDirection: "column",
							gap: 12,
						},
						children: [
							text({
								id: "split-layout-proof-layout",
								text: "Fast layout\nwith Yoga.",
								style: {
									width: 132,
									height: 40,
									fontSize: 15,
									fontWeight: 700,
									lineHeight: 20,
									color: "#111827",
								},
							}),
							text({
								id: "split-layout-proof-tree",
								text: "The solved tree\nbecomes one page\nof typed PDF.",
								style: {
									width: 132,
									height: 60,
									fontSize: 15,
									lineHeight: 20,
									color: "#111827",
								},
							}),
							text({
								id: "split-layout-proof-resources",
								text: "Fonts and colors\nare compilation\nresources.",
								style: {
									width: 132,
									height: 60,
									fontSize: 15,
									lineHeight: 20,
									color: "#111827",
								},
							}),
						],
					}),
				],
			}),
			text({
				id: "split-layout-footer",
				text: "LAYOUT NODE -> SOLVED TREE -> MONDRIAN.PDF",
				style: {
					height: 32,
					fontFamily: "Courier",
					fontSize: 11,
					lineHeight: 16,
					color: "#64748b",
				},
			}),
		],
	}),
}

const portraitLayoutWidth = 382.68
const portraitLayoutHeight = 595.28

export const portraitLayoutStudy: LayoutFixture = {
	slug: "portrait-layout-study",
	description:
		"A compact portrait study with full-height color rails, structured type, and repeated feature panels.",
	width: portraitLayoutWidth,
	height: portraitLayoutHeight,
	node: box({
		id: "portrait-layout-study",
		style: {
			width: portraitLayoutWidth,
			height: portraitLayoutHeight,
			backgroundColor: "#f6f4ff",
			overflow: "hidden",
		},
		children: [
			box({
				id: "portrait-primary-rail",
				style: {
					position: "absolute",
					left: 0,
					top: 0,
					width: 84,
					height: portraitLayoutHeight,
					backgroundColor: "#4c1d95",
				},
				children: [
					text({
						id: "portrait-rail-mark",
						text: "GRID\nLAB",
						style: {
							position: "absolute",
							left: 12,
							top: 24,
							width: 60,
							height: 48,
							fontSize: 21,
							fontWeight: 700,
							lineHeight: 23,
							textAlign: "center",
							color: "#ffffff",
						},
					}),
					box({
						id: "portrait-rail-rule",
						style: {
							position: "absolute",
							left: 12,
							top: 80,
							width: 60,
							height: 4,
							backgroundColor: "#ffffff",
							opacity: 0.88,
						},
					}),
				],
			}),
			box({
				id: "portrait-secondary-rail",
				style: {
					position: "absolute",
					left: 84,
					top: 0,
					width: 12,
					height: portraitLayoutHeight,
					backgroundColor: "#0f766e",
				},
			}),
			box({
				id: "portrait-heading-group",
				style: {
					position: "absolute",
					left: 112,
					top: 32,
					width: 238,
					height: 194,
					flexDirection: "column",
					gap: 7,
				},
				children: [
					text({
						id: "portrait-eyebrow",
						text: "ONE PAGE TARGET",
						style: {
							width: 238,
							height: 18,
							fontSize: 13,
							fontWeight: 700,
							lineHeight: 18,
							color: "#0f766e",
						},
					}),
					text({
						id: "portrait-primary-heading",
						text: "Typed layout\nspecimen",
						style: {
							width: 238,
							height: 50,
							fontSize: 22,
							fontWeight: 700,
							lineHeight: 25,
							color: "#141414",
						},
					}),
					box({
						id: "portrait-heading-rule",
						style: {
							width: 238,
							height: 1.5,
							backgroundColor: "#141414",
						},
					}),
					text({
						id: "portrait-secondary-heading",
						text: "Object graph\ncompilation",
						style: {
							width: 238,
							height: 44,
							fontSize: 18,
							fontWeight: 700,
							lineHeight: 22,
							color: "#141414",
						},
					}),
					text({
						id: "portrait-technical-label",
						text: "PDF 1.7",
						style: {
							width: 238,
							height: 16,
							fontFamily: "Courier",
							fontSize: 11,
							lineHeight: 16,
							color: "#475569",
						},
					}),
				],
			}),
			box({
				id: "portrait-subject-shape",
				style: {
					position: "absolute",
					left: 136,
					top: 252,
					width: 92,
					height: 150,
					backgroundColor: "#ede9fe",
					borderWidth: 3,
					borderColor: "#7c3aed",
					borderRadius: 12,
					alignItems: "center",
					justifyContent: "center",
				},
				children: [
					text({
						id: "portrait-subject-label",
						text: "PDF\nOBJECT",
						style: {
							width: 72,
							height: 34,
							fontFamily: "Courier",
							fontSize: 12,
							fontWeight: 700,
							lineHeight: 17,
							textAlign: "center",
							color: "#5b21b6",
						},
					}),
				],
			}),
			box({
				id: "portrait-page-seal",
				style: {
					position: "absolute",
					right: 28,
					top: 258,
					width: 78,
					height: 78,
					padding: 8,
					alignItems: "center",
					justifyContent: "center",
					backgroundColor: "#ffffff",
					borderWidth: 3,
					borderColor: "#ea580c",
					borderRadius: 39,
				},
				children: [
					text({
						id: "portrait-page-seal-copy",
						text: "1\nPAGE",
						style: {
							width: 56,
							height: 38,
							fontSize: 18,
							fontWeight: 700,
							lineHeight: 19,
							textAlign: "center",
							color: "#ea580c",
						},
					}),
				],
			}),
			box({
				id: "portrait-feature-panel",
				style: {
					position: "absolute",
					left: 108,
					bottom: 28,
					width: 246,
					height: 126,
					padding: 12,
					gap: 8,
					flexDirection: "row",
					alignItems: "center",
					backgroundColor: "#4c1d95",
					borderRadius: 8,
					overflow: "hidden",
				},
				children: [
					["TYPED", "VALUES"],
					["VALID", "GRAPH"],
					["BYTE", "READY"],
				].map(([first, second], index) =>
					box({
						id: `portrait-feature-${index + 1}`,
						style: {
							flexGrow: 1,
							flexShrink: 1,
							height: 94,
							padding: 5,
							gap: 5,
							alignItems: "center",
							justifyContent: "center",
							borderWidth: 1,
							borderColor: "#c4b5fd",
							borderRadius: 5,
						},
						children: [
							box({
								id: `portrait-feature-${index + 1}-icon`,
								style: {
									width: 24,
									height: 24,
									backgroundColor: "#ffffff",
									borderRadius: 12,
									opacity: 0.9,
								},
							}),
							text({
								id: `portrait-feature-${index + 1}-copy`,
								text: `${first}\n${second}`,
								style: {
									width: 62,
									height: 26,
									fontSize: 9,
									fontWeight: 700,
									lineHeight: 13,
									textAlign: "center",
									color: "#ffffff",
								},
							}),
						],
					}),
				),
			}),
		],
	}),
}

const typeSpecimenWidth = 595.28
const typeSpecimenHeight = 841.89

export const fitterHappierTypeSpecimen: LayoutFixture = {
	slug: "fitter-happier-type-specimen",
	description:
		"An A4 editorial specimen combining standard font families, alignment modes, and high-contrast status panels.",
	width: typeSpecimenWidth,
	height: typeSpecimenHeight,
	node: box({
		id: "fitter-happier-type-specimen",
		style: {
			width: typeSpecimenWidth,
			height: typeSpecimenHeight,
			padding: 40,
			gap: 18,
			flexDirection: "column",
			backgroundColor: "#f5f0e6",
			overflow: "hidden",
		},
		children: [
			box({
				id: "type-specimen-meta",
				style: {
					height: 28,
					paddingBottom: 8,
					flexDirection: "row",
					justifyContent: "space-between",
					borderWidth: 1,
					borderColor: "#111111",
				},
				children: [
					text({
						id: "type-specimen-meta-left",
						text: "DOCUMENT FITNESS REPORT",
						style: {
							width: 260,
							height: 14,
							fontFamily: "Courier",
							fontSize: 10,
							fontWeight: 700,
							lineHeight: 14,
							color: "#111111",
						},
					}),
					text({
						id: "type-specimen-meta-right",
						text: "REV 01 / ONE PAGE",
						style: {
							width: 180,
							height: 14,
							fontFamily: "Courier",
							fontSize: 10,
							lineHeight: 14,
							textAlign: "right",
							color: "#111111",
						},
					}),
				],
			}),
			box({
				id: "type-specimen-hero",
				style: {
					height: 250,
					backgroundColor: "#111111",
					borderRadius: 4,
					overflow: "hidden",
				},
				children: [
					text({
						id: "type-specimen-hero-title",
						text: "FITTER\nHAPPIER",
						style: {
							position: "absolute",
							left: 24,
							top: 28,
							width: 390,
							height: 124,
							fontFamily: "Helvetica",
							fontSize: 52,
							fontWeight: 700,
							lineHeight: 60,
							color: "#f5f0e6",
						},
					}),
					text({
						id: "type-specimen-hero-subtitle",
						text: "A LOW-LEVEL COMPILATION TARGET",
						style: {
							position: "absolute",
							left: 28,
							bottom: 28,
							width: 330,
							height: 18,
							fontFamily: "Courier",
							fontSize: 12,
							lineHeight: 18,
							color: "#f5f0e6",
						},
					}),
					box({
						id: "type-specimen-hero-index",
						style: {
							position: "absolute",
							right: 24,
							top: 24,
							width: 92,
							height: 92,
							alignItems: "center",
							justifyContent: "center",
							backgroundColor: "#dc2626",
							borderRadius: 46,
						},
						children: [
							text({
								id: "type-specimen-hero-index-copy",
								text: "01",
								style: {
									width: 64,
									height: 44,
									fontFamily: "Courier",
									fontSize: 38,
									fontWeight: 700,
									lineHeight: 44,
									textAlign: "center",
									color: "#ffffff",
								},
							}),
						],
					}),
				],
			}),
			box({
				id: "type-specimen-status",
				style: {
					height: 68,
					alignItems: "center",
					justifyContent: "center",
					backgroundColor: "#dc2626",
				},
				children: [
					text({
						id: "type-specimen-status-copy",
						text: "MORE PRODUCTIVE",
						style: {
							width: 430,
							height: 34,
							fontFamily: "Helvetica",
							fontSize: 28,
							fontWeight: 700,
							lineHeight: 34,
							textAlign: "center",
							color: "#ffffff",
						},
					}),
				],
			}),
			box({
				id: "type-specimen-columns",
				style: {
					flexGrow: 1,
					flexShrink: 1,
					flexDirection: "row",
					gap: 14,
				},
				children: [
					box({
						id: "type-specimen-column-sans",
						style: {
							flexGrow: 1,
							padding: 14,
							gap: 12,
							justifyContent: "space-between",
							backgroundColor: "#fffdf8",
							borderWidth: 1,
							borderColor: "#111111",
						},
						children: [
							text({
								id: "type-specimen-column-sans-title",
								text: "SANS / LEFT",
								style: {
									height: 20,
									fontFamily: "Helvetica",
									fontSize: 13,
									fontWeight: 700,
									lineHeight: 20,
									color: "#111111",
								},
							}),
							text({
								id: "type-specimen-column-sans-copy",
								text: "Measured boxes\nbecome drawing\noperations.",
								style: {
									height: 66,
									fontFamily: "Helvetica",
									fontSize: 16,
									lineHeight: 22,
									textAlign: "left",
									color: "#111111",
								},
							}),
							text({
								id: "type-specimen-column-sans-spec",
								text: "HELVETICA / 16\nLEADING / 22",
								style: {
									height: 28,
									fontFamily: "Courier",
									fontSize: 8,
									lineHeight: 14,
									color: "#64748b",
								},
							}),
						],
					}),
					box({
						id: "type-specimen-column-serif",
						style: {
							flexGrow: 1,
							padding: 14,
							gap: 12,
							justifyContent: "space-between",
							backgroundColor: "#fffdf8",
							borderWidth: 1,
							borderColor: "#111111",
						},
						children: [
							text({
								id: "type-specimen-column-serif-title",
								text: "SERIF / CENTER",
								style: {
									height: 20,
									fontFamily: "Times",
									fontSize: 13,
									fontWeight: 700,
									lineHeight: 20,
									textAlign: "center",
									color: "#111111",
								},
							}),
							text({
								id: "type-specimen-column-serif-copy",
								text: "One tree\nOne page\nOne target",
								style: {
									height: 66,
									fontFamily: "Times",
									fontSize: 16,
									fontStyle: "italic",
									lineHeight: 22,
									textAlign: "center",
									color: "#111111",
								},
							}),
							text({
								id: "type-specimen-column-serif-spec",
								text: "TIMES / ITALIC\nCENTER / 16",
								style: {
									height: 28,
									fontFamily: "Courier",
									fontSize: 8,
									lineHeight: 14,
									textAlign: "center",
									color: "#64748b",
								},
							}),
						],
					}),
					box({
						id: "type-specimen-column-mono",
						style: {
							flexGrow: 1,
							padding: 14,
							gap: 12,
							justifyContent: "space-between",
							backgroundColor: "#fffdf8",
							borderWidth: 1,
							borderColor: "#111111",
						},
						children: [
							text({
								id: "type-specimen-column-mono-title",
								text: "MONO / RIGHT",
								style: {
									height: 20,
									fontFamily: "Courier",
									fontSize: 13,
									fontWeight: 700,
									lineHeight: 20,
									textAlign: "right",
									color: "#111111",
								},
							}),
							text({
								id: "type-specimen-column-mono-copy",
								text: "BT / ET\nq / Q\nstartxref",
								style: {
									height: 66,
									fontFamily: "Courier",
									fontSize: 15,
									lineHeight: 22,
									textAlign: "right",
									color: "#111111",
								},
							}),
							text({
								id: "type-specimen-column-mono-spec",
								text: "OBJECTS / XREF\nTRAILER / EOF",
								style: {
									height: 28,
									fontFamily: "Courier",
									fontSize: 8,
									lineHeight: 14,
									textAlign: "right",
									color: "#64748b",
								},
							}),
						],
					}),
				],
			}),
			text({
				id: "type-specimen-footer",
				text: "VALIDATED / SERIALIZED / RENDERED",
				style: {
					height: 28,
					fontFamily: "Courier",
					fontSize: 11,
					lineHeight: 16,
					textAlign: "center",
					color: "#111111",
				},
			}),
		],
	}),
}

const nestedCoordinateWidth = 320
const nestedCoordinateHeight = 240

export const nestedCoordinateLab: LayoutFixture = {
	slug: "nested-coordinate-lab",
	description:
		"A compact coordinate test with parent-relative absolute children, painter-order overlaps, and hidden content.",
	width: nestedCoordinateWidth,
	height: nestedCoordinateHeight,
	node: box({
		id: "nested-coordinate-lab",
		style: {
			width: nestedCoordinateWidth,
			height: nestedCoordinateHeight,
			backgroundColor: "#f8fafc",
		},
		children: [
			box({
				id: "nested-outer-frame",
				style: {
					position: "absolute",
					left: 20,
					top: 20,
					width: 280,
					height: 184,
					backgroundColor: "#1e293b",
					borderWidth: 2,
					borderColor: "#0f172a",
					borderRadius: 10,
				},
				children: [
					box({
						id: "nested-inner-card",
						style: {
							position: "absolute",
							left: 28,
							top: 38,
							width: 190,
							height: 110,
							padding: 12,
							gap: 6,
							flexDirection: "column",
							backgroundColor: "#e0f2fe",
							borderWidth: 1,
							borderColor: "#38bdf8",
							borderRadius: 6,
						},
						children: [
							text({
								id: "nested-inner-title",
								text: "LOCAL FRAME",
								style: {
									height: 18,
									fontFamily: "Courier",
									fontSize: 12,
									fontWeight: 700,
									lineHeight: 18,
									color: "#075985",
								},
							}),
							text({
								id: "nested-inner-copy",
								text: "Parent offset\nplus child offset",
								style: {
									height: 36,
									fontSize: 14,
									lineHeight: 18,
									color: "#0c4a6e",
								},
							}),
							box({
								id: "nested-deep-marker",
								style: {
									position: "absolute",
									right: 10,
									bottom: 10,
									width: 22,
									height: 22,
									backgroundColor: "#0284c7",
									borderRadius: 11,
								},
							}),
						],
					}),
					box({
						id: "nested-corner-badge",
						style: {
							position: "absolute",
							right: 12,
							top: 12,
							width: 74,
							height: 28,
							alignItems: "center",
							justifyContent: "center",
							backgroundColor: "#ef4444",
							borderRadius: 14,
						},
						children: [
							text({
								id: "nested-corner-badge-copy",
								text: "GLOBAL",
								style: {
									width: 62,
									height: 14,
									fontFamily: "Courier",
									fontSize: 10,
									fontWeight: 700,
									lineHeight: 14,
									textAlign: "center",
									color: "#ffffff",
								},
							}),
						],
					}),
					box({
						id: "nested-overlap-first",
						style: {
							position: "absolute",
							left: 150,
							top: 126,
							width: 108,
							height: 24,
							backgroundColor: "#facc15",
							opacity: 0.82,
						},
					}),
					box({
						id: "nested-overlap-second",
						style: {
							position: "absolute",
							left: 178,
							top: 138,
							width: 76,
							height: 24,
							backgroundColor: "#a855f7",
							opacity: 0.9,
						},
					}),
					text({
						id: "nested-hidden-sentinel",
						text: "DO NOT RENDER",
						style: {
							display: "none",
							width: 120,
							height: 18,
							fontSize: 14,
							lineHeight: 18,
							color: "#ffffff",
						},
					}),
				],
			}),
			text({
				id: "nested-coordinate-footer",
				text: "TOP LEFT -> PDF SPACE",
				style: {
					position: "absolute",
					left: 20,
					top: 216,
					width: 280,
					height: 14,
					fontFamily: "Courier",
					fontSize: 10,
					lineHeight: 14,
					textAlign: "center",
					color: "#475569",
				},
			}),
		],
	}),
}

const overflowClipWidth = 240
const overflowClipHeight = 180

export const overflowClipLab: LayoutFixture = {
	slug: "overflow-clip-lab",
	description:
		"An explicit clipping stress case with oversized absolute bands, nested clipping, opacity, and a post-clip sibling.",
	width: overflowClipWidth,
	height: overflowClipHeight,
	node: box({
		id: "overflow-clip-lab",
		style: {
			width: overflowClipWidth,
			height: overflowClipHeight,
			backgroundColor: "#f8fafc",
			overflow: "hidden",
		},
		children: [
			text({
				id: "overflow-clip-title",
				text: "OVERFLOW / CLIP LAB",
				style: {
					position: "absolute",
					left: 18,
					top: 12,
					width: 204,
					height: 18,
					fontFamily: "Courier",
					fontSize: 11,
					fontWeight: 700,
					lineHeight: 18,
					textAlign: "center",
					color: "#0f172a",
				},
			}),
			box({
				id: "overflow-clip-window",
				style: {
					position: "absolute",
					left: 28,
					top: 42,
					width: 184,
					height: 96,
					backgroundColor: "#172554",
					borderWidth: 2,
					borderColor: "#1e3a8a",
					borderRadius: 7,
					overflow: "hidden",
				},
				children: [
					box({
						id: "overflow-wide-cyan-band",
						style: {
							position: "absolute",
							left: -36,
							top: 12,
							width: 260,
							height: 30,
							backgroundColor: "#22d3ee",
							opacity: 0.78,
						},
					}),
					box({
						id: "overflow-red-corner",
						style: {
							position: "absolute",
							left: 135,
							top: 46,
							width: 90,
							height: 72,
							backgroundColor: "#ef4444",
							opacity: 0.76,
						},
					}),
					box({
						id: "overflow-nested-window",
						style: {
							position: "absolute",
							left: 38,
							top: 20,
							width: 110,
							height: 58,
							borderWidth: 1,
							borderColor: "#ffffff",
							borderRadius: 4,
							overflow: "hidden",
						},
						children: [
							box({
								id: "overflow-nested-yellow-band",
								style: {
									position: "absolute",
									left: -20,
									top: 34,
									width: 156,
									height: 38,
									backgroundColor: "#fde047",
									opacity: 0.88,
								},
							}),
						],
					}),
					text({
						id: "overflow-clip-copy",
						text: "CLIPPED TEXT\nSTAYS INSIDE",
						style: {
							position: "absolute",
							left: -18,
							top: 52,
							width: 250,
							height: 34,
							fontFamily: "Courier",
							fontSize: 12,
							fontWeight: 700,
							lineHeight: 17,
							textAlign: "center",
							color: "#ffffff",
						},
					}),
				],
			}),
			text({
				id: "overflow-after-clip",
				text: "AFTER CLIP: GRAPHICS STATE RESTORED",
				style: {
					position: "absolute",
					left: 18,
					top: 148,
					width: 204,
					height: 16,
					fontFamily: "Courier",
					fontSize: 8,
					lineHeight: 16,
					textAlign: "center",
					color: "#334155",
				},
			}),
		],
	}),
}

export const jpegContactSheet: LayoutFixture = {
	slug: "jpeg-contact-sheet",
	description:
		"A repeated baseline JPEG proves contain fitting and XObject resource reuse across differently sized nodes.",
	width: 420,
	height: 300,
	node: box({
		id: "jpeg-contact-sheet",
		style: {
			width: 420,
			height: 300,
			padding: 24,
			gap: 16,
			flexDirection: "column",
			backgroundColor: "#f8fafc",
		},
		children: [
			text({
				id: "jpeg-contact-sheet-title",
				text: "ONE JPEG / THREE PLACEMENTS",
				style: {
					height: 24,
					fontFamily: "Courier",
					fontSize: 16,
					fontWeight: 700,
					lineHeight: 24,
					color: "#0f172a",
				},
			}),
			box({
				id: "jpeg-contact-sheet-body",
				style: {
					flexGrow: 1,
					gap: 16,
					flexDirection: "row",
				},
				children: [
					box({
						id: "jpeg-contact-sheet-hero",
						style: {
							width: 180,
							padding: 12,
							gap: 8,
							alignItems: "center",
							backgroundColor: "#ffffff",
							borderColor: "#cbd5e1",
							borderWidth: 1,
							borderRadius: 10,
						},
						children: [
							image({
								id: "jpeg-contact-sheet-hero-image",
								src: sampleJpegDataUrl,
								intrinsicWidth: 2,
								intrinsicHeight: 3,
								style: { width: 108, height: 162 },
							}),
							text({
								id: "jpeg-contact-sheet-hero-label",
								text: "HERO / CONTAIN",
								style: {
									width: 150,
									height: 16,
									fontFamily: "Courier",
									fontSize: 10,
									lineHeight: 16,
									textAlign: "center",
									color: "#475569",
								},
							}),
						],
					}),
					box({
						id: "jpeg-contact-sheet-thumbnails",
						style: {
							flexGrow: 1,
							gap: 12,
							flexDirection: "column",
						},
						children: [
							["WIDE BOX", 196, 82],
							["TALL BOX", 196, 102],
						].map(([label, width, height]) =>
							box({
								id: `jpeg-contact-sheet-${String(label).toLowerCase().replaceAll(" ", "-")}`,
								style: {
									width: Number(width),
									height: Number(height),
									padding: 8,
									gap: 12,
									flexDirection: "row",
									alignItems: "center",
									backgroundColor: "#e2e8f0",
									borderRadius: 6,
								},
								children: [
									image({
										src: sampleJpegDataUrl,
										intrinsicWidth: 2,
										intrinsicHeight: 3,
										style: { width: 44, height: Number(height) - 16 },
									}),
									text({
										text: String(label),
										style: {
											flexGrow: 1,
											height: 16,
											fontFamily: "Courier",
											fontSize: 10,
											lineHeight: 16,
											color: "#334155",
										},
									}),
								],
							}),
						),
					}),
				],
			}),
		],
	}),
}

export const layoutFixtures = Object.freeze([
	splitLayoutSpecimen,
	portraitLayoutStudy,
	fitterHappierTypeSpecimen,
	nestedCoordinateLab,
	overflowClipLab,
	jpegContactSheet,
] satisfies readonly LayoutFixture[])
