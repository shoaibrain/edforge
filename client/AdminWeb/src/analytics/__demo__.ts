import type { FleetSummary } from '@aibrains/shared-types';
export function describe(s: FleetSummary): string {
  return `${s.active} active, ${s.inactive} inactive`;
}
