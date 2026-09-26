---
"mondrian.pdf": patch
---

Accept indirect page content arrays and indirect Info values during validation and serialization, checking their resolved values while retaining the original references.

Validate UTF-16BE and PDF 2.0 UTF-8 date strings after decoding their text, preserving their original bytes and checking encoding, PDF version, and calendar validity.

Add the explicit `preserveInvalidDates` option to `validatePdf()` and `serializePdf()` for retaining nonstandard imported Info date strings unchanged. Invalid date syntax becomes a warning with this option; invalid encodings and other structural errors still block serialization.
