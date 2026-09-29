---
"mondrian.pdf": patch
---

Add `prepareCmykImage()` in `mondrian.pdf/print` to convert PNG and JPEG images using explicit ICC printing profiles and bounded image decoding while preserving straight color samples and per-pixel transparency. Embed the prepared CMYK samples and alpha through `pdf.image()` with a matching document output intent.

Preview the delivered image samples on colored CMYK and spot plates, preserving transparent cut-out edges, knockout, and overprint while reusing shared image masks within each preview. Includes an example and rendered proofs for a transparent photographic PNG over process and spot inks.
