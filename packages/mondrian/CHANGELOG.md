# mondrian.pdf

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
