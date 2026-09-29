# mondrian.pdf

## 0.1.9

### Patch Changes

- b74d735: Export `PdfGrayColor`, `PdfRgbColor`, `PdfCmykColor`, and `PdfSeparationColor` individually while retaining them in the `PdfColor` union. The `gray()`, `rgb()`, `cmyk()`, and `spot()` helpers now return their specific color types, allowing callers to use space-specific components and tint values without narrowing a union.

## 0.1.8

### Patch Changes

- 11e0844: Preserve ordinary marked content in plate previews, including `ActualText`, nested tags, marked points, and inline or named property dictionaries on pages and Forms. Validate marked-content and text-object boundaries while continuing to reject unsupported optional-content painting.
- a0b050f: Add `renderPdfPlateCoverage()` to `mondrian.pdf/testing` for numeric ink evidence from a `PdfDocument`, including parsed delivered PDFs. Return grayscale PNGs and one-byte inverse-coverage samples for each plate and page, with paper white, full ink black, resolution, and renderer provenance. Coverage comes from process samples and spot tints before display color conversion, retaining supported opacity, cut-out alpha, clipping, knockout, and overprint.
- 84e150b: Add `prepareCmykImage()` in `mondrian.pdf/print` to convert PNG and JPEG images using explicit ICC printing profiles and bounded image decoding while preserving straight color samples and per-pixel transparency. Embed the prepared CMYK samples and alpha through `pdf.image()` with a matching document output intent.

  Preview the delivered image samples on colored CMYK and spot plates, preserving transparent cut-out edges, knockout, and overprint while reusing shared image masks within each preview. Includes an example and rendered proofs for a transparent photographic PNG over process and spot inks.

## 0.1.7

### Patch Changes

- de7aee3: Add `parsePdf()` to read raw PDF byte strings or `Uint8Array` inputs into `PdfDocument`, preserving object identities, decoded name and string bytes, encoded streams, metadata, and file identifiers. Support classic and streamed cross-references, hybrid files, incremental revisions, and compressed objects.

  Support AES-256 Standard encryption (revisions 5 and 6) with empty, user, or owner passwords supplied as ASCII strings or prepared UTF-8 bytes. Parsed documents serialize as unencrypted PDFs; full rewriting does not preserve password restrictions, digital signatures, incremental history, or linearization.

  Provide `PdfParseError` with byte offsets, configurable structural decoding limits, and opt-in recovery through `recover` and `onWarning`. Strict parsing remains the default.
- de7aee3: Accept indirect page content arrays and indirect Info values during validation and serialization, checking their resolved values while retaining the original references.

  Validate UTF-16BE and PDF 2.0 UTF-8 date strings after decoding their text, preserving their original bytes and checking encoding, PDF version, and calendar validity.

  Add the explicit `preserveInvalidDates` option to `validatePdf()` and `serializePdf()` for retaining nonstandard imported Info date strings unchanged. Invalid date syntax becomes a warning with this option; invalid encodings and other structural errors still block serialization.

## 0.1.6

### Patch Changes

- 754828d: Support Vitest 5 in `mondrian.pdf/vitest` while retaining Vitest 4 compatibility, with a peer dependency range of `^4.1.3 || ^5.0.0`. The PDF artifact matcher keeps its existing arguments and asynchronous `Promise<void>` return type; existing test calls do not need to change.

## 0.1.5

### Patch Changes

- 1e30b90: Add `previewPdfPlates(document, { permitColors })` to `mondrian.pdf/testing` to discover CMYK and named spot plates and return an independent, ink-colored `PdfDocument` for each. Previews preserve vector paths, live text and positioning, Forms, knockout, overprint, and constant opacity with Normal blending, excluding combined fill/stroke operations with unequal opacities and transparent overprinting text with text knockout enabled. Equivalent definitions of the same spot ink are accepted; conflicting definitions fail. Discovery rejects forbidden color spaces and unsupported painting before creating previews; permitted colors default to CMYK and spots.

## 0.1.4

### Patch Changes

- bdd8ee8: Treat renderer metadata as provenance in PDF visual artifacts, so PDFium upgrades
  with identical pixels and rendering settings pass without rewriting baselines.
  Report the installed PDFium version instead of a hardcoded version.

## 0.1.3

### Patch Changes

- 8610a83: Restore browser bundling of the core entrypoint by replacing Node-only color-content compression with browser-compatible synchronous zlib compression. Preserve the existing `compressColorContent` API and bound resource requirements.

## 0.1.2

### Patch Changes

- 38ed899: Add shared typed gray, RGB, CMYK, and named Separation paint APIs for graphics, live text, and object-builder content. Validate normalized channels, exponential tint transforms, ink conflicts, version requirements, and explicit opaque overprint/knockout states. Bind immutable cached color fragments into fresh document resources. Add text rendering modes, conformance proofs, and migration examples; document the supported print-color boundaries. Preserve explicit resource requirements through compression, Form construction, and document cloning, including validation of nested Form scopes. Compare resource references by object number and generation, and derive color-resource version requirements from emitted dictionaries so manual copies retain validation.
- 07c74a8: Add npm version, runtime dependency count, and coverage badges to the package README.

## 0.1.1

### Patch Changes

- d6dbed4: Expose PDF document, metadata, and object inspection through `mondrian.pdf/testing`.

## 0.1.0

### Minor Changes

- 2c05746: Add Vitest coverage reporting and PDF visual artifact testing through the new
  `mondrian.pdf/testing` and `mondrian.pdf/vitest` entry points. Visual artifacts
  use a pinned PDFium WebAssembly renderer for exact, platform-independent pixels.
