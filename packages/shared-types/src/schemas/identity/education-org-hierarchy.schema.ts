/**
 * Education Organization Hierarchy Schemas - Identity Service
 *
 * Zod schemas for the hierarchy tree API response.
 * Used by the GET /education-organizations/hierarchy endpoint.
 */

import { z } from 'zod';
import { educationOrgTypeSchema, operationalStatusSchema } from './education-organization.schema';

// ============================================
// Hierarchy Node (Recursive)
// ============================================

/**
 * Base hierarchy node fields (non-recursive).
 * Recursive `children` is added via z.lazy().
 */
const hierarchyNodeBaseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: educationOrgTypeSchema,
  edfiId: z.number().int().optional(),                           // Ed-Fi numeric ID (SEA/LEA/ESC/School ID)
  status: operationalStatusSchema,
  schoolCount: z.number().int().min(0).optional(),               // Aggregate: schools under this node
  studentCount: z.number().int().min(0).optional(),              // Aggregate: students
  staffCount: z.number().int().min(0).optional(),                // Aggregate: staff
});

export type HierarchyNode = z.infer<typeof hierarchyNodeBaseSchema> & {
  children: HierarchyNode[];
};

export const hierarchyNodeSchema: z.ZodType<HierarchyNode> = hierarchyNodeBaseSchema.extend({
  children: z.lazy(() => z.array(hierarchyNodeSchema)),
});

// ============================================
// Organization Hierarchy Response
// ============================================

/**
 * Full hierarchy tree response.
 * - `sea`: The root SEA node with all children (LEAs → Schools), or null if no SEA exists.
 * - `educationServiceCenters`: ESCs are siblings to LEAs, not nested under them.
 * - `unassigned`: Schools not linked to any LEA.
 */
export const organizationHierarchyResponseSchema = z.object({
  sea: hierarchyNodeSchema.nullable(),
  educationServiceCenters: z.array(hierarchyNodeSchema),
  unassigned: z.array(hierarchyNodeSchema),
});

export type OrganizationHierarchyResponseDto = z.infer<typeof organizationHierarchyResponseSchema>;
