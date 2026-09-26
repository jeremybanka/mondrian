---
"mondrian.pdf": patch
---

Add `previewPdfPlates(document, { permitColors })` to `mondrian.pdf/testing` to discover CMYK and named spot plates and return an independent, ink-colored `PdfDocument` for each. Previews preserve vector paths, live text, Forms, knockout, overprint, and constant opacity with Normal blending, excluding combined fill/stroke operations with unequal opacities and transparent overprinting text with text knockout enabled. Discovery rejects forbidden color spaces and unsupported painting before creating previews; permitted colors default to CMYK and spots.
