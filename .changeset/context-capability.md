---
"@dudousxd/nestjs-context": patch
---

Register `context:accessor` as a typed capability in the ecosystem protocol's `CapabilityRegistry` (type-only augmentation) and add a conformance test (`assertCapabilityNaming`) that locks the canonical token naming. `@dudousxd/nestjs-diagnostics` stays an OPTIONAL peer — no runtime dependency added; context still works standalone.
