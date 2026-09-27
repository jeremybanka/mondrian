---
"mondrian.pdf": minor
---

Support Vitest 5 in `mondrian.pdf/vitest` while retaining Vitest 4 compatibility. The PDF artifact matcher keeps its existing arguments and asynchronous `Promise<void>` return type; existing test calls do not need to change.
