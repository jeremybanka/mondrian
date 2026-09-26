---
"mondrian.pdf": patch
---

Add `parsePdf()` to read raw PDF byte strings or `Uint8Array` inputs into `PdfDocument`, preserving object numbers, generations, names, strings, encoded streams, metadata references, and identifiers. Support classic and streamed cross-references, hybrid files, incremental revisions, and compressed objects with common structural filters and predictors. Normalize direct PDF 2.0 information dictionaries into the reference-based document model. Return the current object graph without historical cross-reference containers. Validate structural stream checksums. Provide configurable per-stream and cumulative decoded-byte limits for structural streams. Export `PdfParseError` with byte offsets for malformed or unsupported input, including encrypted PDFs.
