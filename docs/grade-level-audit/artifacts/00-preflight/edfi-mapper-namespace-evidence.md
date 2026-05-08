---
title: F-EDFI-1 verified — ECD/PPC emit under wrong Ed-Fi namespace
captured: 2026-05-08 (code read)
---

# Ed-Fi outbound mapper — namespace handling for extension descriptors

## Code-level evidence

[packages/shared-types/src/mappers/edfi/education-org.mapper.ts:224-249](../../../packages/shared-types/src/mappers/edfi/education-org.mapper.ts#L224-L249):

```ts
function mapGradeLevel(value: string): string {
  const gradeLabels: Record<string, string> = {
    InfantToddler: 'Infant/toddler',
    Prenursery: 'Prenursery',
    Nursery: 'Nursery',
    Prekindergarten: 'Pre-Kindergarten',
    TransitionalKindergarten: 'Transitional Kindergarten',
    Kindergarten: 'Kindergarten',
    FirstGrade: 'First grade',
    // ... SecondGrade through TwelfthGrade ...
    Postsecondary: 'Postsecondary',
    Ungraded: 'Ungraded',
    Other: 'Other',
  };
  return toEdFiDescriptorUri('GradeLevelDescriptor', gradeLabels[value] || value);
}
```

**Missing keys:** `EarlyChildhoodDevelopment`, `PrePrimaryClass`.

When the school stores `gradeLevels: ['EarlyChildhoodDevelopment', ...]` and the export mapper runs, the fallback `value` is used and `toEdFiDescriptorUri('GradeLevelDescriptor', 'EarlyChildhoodDevelopment')` at line 150-151 produces:

```
uri://ed-fi.org/GradeLevelDescriptor#EarlyChildhoodDevelopment
```

## Why this is wrong

Ed-Fi Data Standard v6 §5.2.4 (Extension Descriptors): implementer-defined descriptors that are NOT in the core specification MUST use the implementer's own namespace, not `ed-fi.org`. The core `GradeLevelDescriptor` namespace at `uri://ed-fi.org/GradeLevelDescriptor` is a closed enum — `EarlyChildhoodDevelopment` and `PrePrimaryClass` aren't members.

Strict Ed-Fi consumers (e.g., a CEHRD Flash III pull, an Ed-Fi ODS interop endpoint) would either:
- Reject the URI outright (descriptor unknown in core namespace)
- Silently drop the field (treat as unrecognized)
- Accept it permissively (if validator is lax)

Either way, EdForge's Ed-Fi compliance claim is degraded.

## Severity

**MEDIUM, conditional on consumer existing.** Per [CLAUDE.md § Shared types](../../../CLAUDE.md):

> Outbound Ed-Fi compliance exports only

No live consumer is currently identified. The export mappers are lying-in-wait code. **F-EDFI-1 is therefore MEDIUM "fix before any Ed-Fi consumer comes online" rather than HIGH "fix before next pilot."**

## Fix

Two-line change. Add explicit entries to `mapGradeLevel` that route extensions through a different namespace builder:

```ts
function mapGradeLevel(value: string): string {
  // Extension descriptors — routed through implementer namespace
  if (value === 'EarlyChildhoodDevelopment') {
    return 'uri://edforge.app/GradeLevelDescriptor#EarlyChildhoodDevelopment';
  }
  if (value === 'PrePrimaryClass') {
    return 'uri://edforge.app/GradeLevelDescriptor#PrePrimaryClass';
  }
  // Core descriptors — existing logic
  const gradeLabels: Record<string, string> = { /* ... */ };
  return toEdFiDescriptorUri('GradeLevelDescriptor', gradeLabels[value] || value);
}
```

A future cleanup could refactor the URI builder to take a namespace argument (`'ed-fi.org' | 'edforge.app'`) and route at the descriptor-catalog level, but the inline-fix above is the right scope for this fix.

## Test cases

| Input | Expected URI |
|---|---|
| `'FirstGrade'` | `uri://ed-fi.org/GradeLevelDescriptor#First grade` (current behavior preserved) |
| `'Kindergarten'` | `uri://ed-fi.org/GradeLevelDescriptor#Kindergarten` |
| `'EarlyChildhoodDevelopment'` | `uri://edforge.app/GradeLevelDescriptor#EarlyChildhoodDevelopment` |
| `'PrePrimaryClass'` | `uri://edforge.app/GradeLevelDescriptor#PrePrimaryClass` |
| `'UnknownValue'` | `uri://ed-fi.org/GradeLevelDescriptor#UnknownValue` (fallback preserved) |

## Adjacent observation: case-mismatch in core-descriptor labels

Several core-descriptor labels in the existing map use Title Case followed by lowercase second word: `'First grade'`, `'Second grade'`, `'Third grade'`, etc. Ed-Fi v6 spec uses Title Case throughout: `'First Grade'`, `'Second Grade'`. **Possible existing non-conformance even on core values.** Out of audit scope but worth a 5-minute compare against the Ed-Fi v6 GradeLevelDescriptor.csv before fixing F-EDFI-1.
