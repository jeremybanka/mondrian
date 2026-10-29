---
"mondrian.pdf": patch
---

Skip diagnostic canvas allocation and PNG encoding for PDF artifact pages with identical dimensions and decoded RGBA pixels, reducing CPU and memory use during successful comparisons while preserving exact pixel matching and mismatch diagnostics.
