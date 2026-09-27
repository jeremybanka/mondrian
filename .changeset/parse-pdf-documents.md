---
"mondrian.pdf": patch
---

Add `parsePdf()` to read raw PDF byte strings or `Uint8Array` inputs into `PdfDocument`, preserving existing object numbers, generations, decoded names and string bytes, encoded streams, metadata references, and identifiers. Support classic and streamed cross-references, hybrid files, incremental revisions, and compressed objects with common structural filters and predictors, including object streams with header extension data. Normalize direct PDF 2.0 information dictionaries into the reference-based document model and expose live object values from the latest revisions. Validate structural stream checksums and reject integer values outside the supported safe range. Provide configurable per-stream and cumulative decoded-byte limits for structural streams. Export `PdfParseError` with byte offsets for malformed or unsupported input.

Decrypt AES-256 Standard security handlers (revisions 5 and 6) using an empty, user, or owner password. Accept ASCII password strings or prepared UTF-8 password bytes. Honor crypt-filter defaults for strings, streams, and embedded files, and preserve encryption-exempt signature bytes. Return decrypted objects for deterministic unencrypted parse/serialize round trips, preserving encoded content streams and excluding encryption dictionaries; password restrictions and digital signatures are not preserved by full serialization.

Offer explicit recovery of a PDF header within the first 1,024 input bytes and zero-offset in-use cross-reference entries. Interpret offsets relative to the recovered header and report each recovery through `onWarning`. Strict parsing remains the default.
