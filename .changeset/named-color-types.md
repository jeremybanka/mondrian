---
"mondrian.pdf": patch
---

Export `PdfGrayColor`, `PdfRgbColor`, `PdfCmykColor`, and `PdfSeparationColor` individually while retaining them in the `PdfColor` union. The `gray()`, `rgb()`, `cmyk()`, and `spot()` helpers now return their specific color types, allowing callers to use space-specific components and tint values without narrowing a union.
