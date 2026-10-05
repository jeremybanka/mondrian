import { atom } from "atom.io"

export const selectedObjectAtom = atom({ key: "guide/object", default: 3 })
export const representationAtom = atom<"syntax" | "model">({
	key: "guide/representation",
	default: "syntax",
})
export const drawingXAtom = atom({ key: "guide/drawing-x", default: 48 })
export const drawingStepAtom = atom({ key: "guide/drawing-step", default: 4 })
export const fileSectionAtom = atom({
	key: "guide/file-section",
	default: "objects",
})
export const menuOpenAtom = atom({ key: "guide/menu", default: false })
