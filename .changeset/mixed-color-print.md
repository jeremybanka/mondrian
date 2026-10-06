---
"mondrian.pdf": patch
---

Support tagged RGB raster authoring with explicit source ICC profiles, straight alpha, document blending intent, and profile-qualified RGB spot alternates. Add explicit PDF preparation for a caller-selected CMYK printing condition, with rendering-intent, gray, process-number, spot-preservation, and destination-blending policies plus a reproducible conversion report. Preserve live text, vectors, image dimensions and alpha, K-only process paint, and named inks. Resolve vector/text conversion using the rendering intent active at painting, including reused colors and scoped/inherited state, and preserve ordinary opacity settings such as explicit `AIS: false`.

Extract established ICCBased CMYK channels and baseline CMYK JPEG samples without destination conversion. Support bounded image predictors/default DecodeParms, normalized Decode ranges, and opt-in gray-to-black plate interpretation.

Reuse equivalent Form preparations while preserving inherited paint and page-resource context, with configurable aggregate Form context and program-byte limits.
