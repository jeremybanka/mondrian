---
"mondrian.pdf": patch
---

Restore browser bundling of the core entrypoint by replacing Node-only color-content compression with browser-compatible synchronous zlib compression. Preserve the existing `compressColorContent` API and bound resource requirements.
