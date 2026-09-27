---
"mondrian.pdf": patch
---

Support Vitest 5 in `mondrian.pdf/vitest` while retaining Vitest 4 compatibility, with a peer dependency range of `^4.1.3 || ^5.0.0`. The PDF artifact matcher keeps its existing arguments and asynchronous `Promise<void>` return type; existing test calls do not need to change.
