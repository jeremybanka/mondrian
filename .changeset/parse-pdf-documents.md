---
"mondrian.pdf": patch
---

Add `parsePdf()` to read raw PDF byte strings or `Uint8Array` inputs into `PdfDocument`, preserving object numbers, generations, names, strings, encoded streams, metadata references, and identifiers. Support classic and streamed cross-references, hybrid files, incremental revisions, and compressed objects with common structural filters and predictors. Export `PdfParseError` with byte offsets for malformed or unsupported input, including encrypted PDFs.
