# Legacy Modules

This folder contains frozen, backward-compatible modules kept for stability.

## Harmony v1 (Frozen)

Location:
- `src/_legacy/analyze/harmonyAnalyzer.ts`
- `src/_legacy/analyze/harmonyTypes.ts`

API routes that depend on v1:
- `POST /analyze_harmony_v1`
- `POST /attach_harmony_v1`

Policy:
- Treat v1 modules as frozen.
- Only allow minimal bug fixes that preserve output shape and semantics.
- New features belong in v2 modules under `src/harmony/`.
- Attach behavior should store analysis at `scoreModel.meta.harmony` (avoid top-level `scoreModel.harmony`).