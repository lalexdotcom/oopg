---
quick_id: 260323-rng
description: fix build entry point error
date: 2026-03-23
---

# Quick Task 260323-rng: fix build entry point error

## Root Cause

rslib defaults to `src/index.ts` as entry point. The project entry is `index.ts` at the root.

## Fix

Add `source.entry: { index: './index.ts' }` to `rslib.config.ts`.

## Tasks

- [x] Add `source.entry` to `rslib.config.ts`
- [x] Verify `pnpm build` passes
