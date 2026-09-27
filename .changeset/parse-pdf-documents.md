---
"mondrian.pdf": patch
---

Add `parsePdf()` to read raw PDF byte strings or `Uint8Array` inputs into `PdfDocument`, preserving object identities, decoded name and string bytes, encoded streams, metadata, and file identifiers. Support classic and streamed cross-references, hybrid files, incremental revisions, and compressed objects.

Support AES-256 Standard encryption (revisions 5 and 6) with empty, user, or owner passwords supplied as ASCII strings or prepared UTF-8 bytes. Parsed documents serialize as unencrypted PDFs; full rewriting does not preserve password restrictions, digital signatures, incremental history, or linearization.

Provide `PdfParseError` with byte offsets, configurable structural decoding limits, and opt-in recovery through `recover` and `onWarning`. Strict parsing remains the default.
