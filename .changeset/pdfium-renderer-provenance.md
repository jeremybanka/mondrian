---
"mondrian.pdf": patch
---

Treat renderer metadata as provenance in PDF visual artifacts, so PDFium upgrades
with identical pixels and rendering settings pass without rewriting baselines.
Report the installed PDFium version instead of a hardcoded version.
