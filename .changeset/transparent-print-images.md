---
"mondrian.pdf": patch
---

Add `prepareCmykImage()` in `mondrian.pdf/print` to convert PNG and JPEG images using explicit ICC printing profiles while preserving per-pixel transparency. Embed the prepared CMYK samples and alpha through `pdf.image()` with a matching document output intent.
