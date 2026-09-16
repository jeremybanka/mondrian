# mondrian.pdf

## 0.1.1

### Patch Changes

- d6dbed4: Expose PDF document, metadata, and object inspection through `mondrian.pdf/testing`.

## 0.1.0

### Minor Changes

- 2c05746: Add Vitest coverage reporting and PDF visual artifact testing through the new
  `mondrian.pdf/testing` and `mondrian.pdf/vitest` entry points. Visual artifacts
  use a pinned PDFium WebAssembly renderer for exact, platform-independent pixels.
