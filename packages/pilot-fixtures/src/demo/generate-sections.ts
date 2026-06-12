/**
 * Section (homeroom cohort) generator — Sprint S1.4.
 *
 * One DemoSection per (grade, label) from the roster config. Pure; the
 * cohorts are the unit students are assigned to (S1.6) and the unit
 * course-sections are created for (S1.7).
 */

import type { DemoRosterConfig } from './roster-config';
import type { DemoSection } from './generated-types';

export function generateSections(config: DemoRosterConfig): DemoSection[] {
  const sections: DemoSection[] = [];
  for (const grade of config.gradeLevels) {
    for (const label of grade.sections) {
      sections.push({
        ref: `section:${grade.code}-${label}`,
        gradeCode: grade.code,
        label,
        name: `${grade.label} ${label}`,
      });
    }
  }
  return sections;
}
