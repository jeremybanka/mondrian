---
"mondrian.pdf": patch
---

Add `renderPdfPlateCoverage()` to `mondrian.pdf/testing` for numeric ink evidence from a `PdfDocument`, including parsed delivered PDFs. Return grayscale PNGs and one-byte inverse-coverage samples for each plate and page, with paper white, full ink black, resolution, and renderer provenance. Coverage comes from process samples and spot tints before display color conversion, retaining supported opacity, cut-out alpha, clipping, knockout, and overprint.
