# Classrooms Production Sprint Plan

> **Goal**: Revisit, assess, and improve the Classrooms end-to-end functionality, UI/UX, application interfaces, security — production-ready for EdForge EMIS platform.

---

## Sprint 0: Data Model Design Spike

**Goal**: Settle critical architectural decisions before building. Define the Classwork-to-Grade relationship, finalize DynamoDB key patterns, and create shared-types schemas.

**Demoable Outcome**: Documented architecture decisions, shared-types package with Classwork schemas, entity type registrations — the foundation for Sprint 3.

---

### Task 0.1: Design Classwork-to-Grade Bridge Architecture

**Context**: Currently, assignments live as embedded `AssignmentGrade[]` inside the `Grade` entity (`server/application/microservices/academics/src/common/entities/grade.entity.ts`). The new Classwork entity stores assignments as standalone items. We need to define how these relate.

**Decision to Make**: When a teacher creates a graded assignment in Classwork, how does it connect to the gradebook?
- **Option A (Recommended)**: Classwork `itemId` becomes the `assignmentId` on `AssignmentGrade`. Classwork is the source of truth for assignment metadata (name, dueDate, possiblePoints). Grade entity references `assignmentId` for scoring only.
- **Option B**: Denormalized — copy assignment metadata to both entities, keep them loosely coupled.
- **Option C**: Full migration — replace inline `assignments[]` on Grade with references to Classwork items.

**Deliverable**: Written ADR (Architecture Decision Record) documenting the chosen approach and migration path.

**Validation**: ADR reviewed and approved. No ambiguity about data ownership.

---

### Task 0.2: Design Classwork DynamoDB Key Patterns

**Files**:
- New: `server/application/microservices/academics/src/common/entities/classwork.entity.ts`
- Update: `server/application/microservices/academics/src/common/entities/base.entity.ts`

**ClassworkItem Keys** (optimized — sort order NOT in GSI key to avoid delete+put on reorder):
```
PK: TENANT#{tenantId}
SK: CLASSWORK#{schoolId}#{sectionId}#{itemId}
GSI1PK: TENANT#{tid}#SCHOOL#{schoolId}
GSI1SK: CLASSWORK#{sectionId}#{itemId}
```
- `sortOrder` stored as a regular attribute, sorted in-memory (sections will have <200 items)

**ClassworkTopic Keys**:
```
PK: TENANT#{tenantId}
SK: CLASSWORK_TOPIC#{schoolId}#{sectionId}#{topicId}
GSI1PK: TENANT#{tid}#SCHOOL#{schoolId}
GSI1SK: CLASSWORK_TOPIC#{sectionId}#{topicId}
```
- `sortOrder` stored as a regular attribute

**Entity Fields**:
- ClassworkItem: `itemId`, `sectionId`, `schoolId`, `type` (assignment/quiz/material/question), `title`, `description`, `topicId`, `topicName`, `dueDate`, `possiblePoints`, `status` (draft/published/scheduled), `assessmentCategory` (formative/summative), `categoryId` (links to grading policy), `attachments[]`, `sortOrder`, `createdBy`, `createdAt`, `updatedAt`, `version`
- ClassworkTopic: `topicId`, `sectionId`, `schoolId`, `name`, `sortOrder`, `createdAt`, `updatedAt`, `version`

**Also**:
- Add `'CLASSWORK' | 'CLASSWORK_TOPIC'` to `EntityType` union in `base.entity.ts`
- Add key builders to `EntityKeyBuilder` and `GSIKeyBuilder`

**Validation**: Entity file compiles. Key patterns consistent with existing conventions. No SK collisions. EntityType union updated.

---

### Task 0.3: Create Shared-Types Classwork Schema

**Files**:
- New: `packages/shared-types/src/schemas/academics/classwork.schema.ts`
- Update: `packages/shared-types/src/schemas/academics/index.ts`

**Changes**:
- Define TypeScript interfaces/Zod schemas:
  - `ClassworkItemType` enum: `'assignment' | 'quiz' | 'material' | 'question'`
  - `ClassworkItemStatus` enum: `'draft' | 'published' | 'scheduled'`
  - `ClassworkItemResponseDto`: Full item DTO
  - `CreateClassworkItemDto`: Create payload
  - `UpdateClassworkItemDto`: Partial update payload
  - `ClassworkTopicResponseDto`: Topic DTO
  - `CreateClassworkTopicDto` / `UpdateClassworkTopicDto`
  - `SectionClassworkResponseDto`: Section's classwork grouped by topics
- Export from index.ts
- Rebuild shared-types package

**Validation**: Package builds without errors. Types importable from both frontend and backend.

---

## Sprint 1: Classrooms Overview Page Polish & Section Cards

**Goal**: Redesign the `/academics/classrooms` overview page to be clean, elegant, and information-dense without clutter. Think Google Classroom meets Apple design.

**Demoable Outcome**: A polished Classrooms landing page with refined stats, cleaner cards, improved filters, and a modern visual hierarchy.

---

### Task 1.1: Redesign Stats Bar with Contextual Metrics

**File**: `edforge-saas-frontend/apps/academics/src/routes/classrooms/index.tsx`

**Current State**: Four stat cards (Total Classes, Total Students, Capacity Utilization, Teachers) displayed as equal-weight cards.

**Changes**:
- Replace the 4-card grid with a compact, single-row summary strip using a horizontal layout with dividers
- Primary stat (Total Classes) larger/bolder; secondary stats (Students, Utilization, Teachers) smaller inline
- Add a subtle trend indicator (e.g., active vs inactive ratio)
- Use muted color palette — no colored icons; use typography weight and size for hierarchy
- Add a quick-action button ("+ New Section") anchored right in the stats bar

**Validation**: Visual diff screenshot before/after. Stats render correctly with real data. Responsive on tablet/mobile breakpoints (stacks on mobile).

---

### Task 1.2: Refine Section Card Design & Skeleton Loader

**Files**:
- `components/classrooms/ClassroomCard.tsx`
- `components/classrooms/ClassroomCardGrid.tsx`
- `components/classrooms/ClassroomCardSkeleton.tsx`
- `lib/classroom-colors.ts`

**Current State**: Cards with subject-color gradient covers, instructor avatar, enrollment count, status badge.

**Changes**:
- Reduce card cover height from large banner to a slim 8px color stripe at top (subject-area color)
- Move section name to be the primary text, course name secondary/muted
- Teacher name as a subtle subtitle, remove the avatar from the card (declutter)
- Enrollment shown as a compact progress bar with fraction label (e.g., "6/30")
- Status badge: small dot indicator (green=active, gray=inactive) instead of text badge
- Card hover: subtle elevation shadow + border highlight
- Card click navigates to detail page (existing behavior, confirm works)
- Three-dot menu: keep edit/toggle-active actions
- Update `ClassroomCardSkeleton` to match new slim-card layout (pulse animation for stripe, title, subtitle, progress bar)

**Validation**: Cards render correctly for all 11 subject areas. Grid responsive at 1/2/3/4 column breakpoints. Hover/click states work. Skeleton matches new card shape. No layout shift on data load.

---

### Task 1.3: Improve Filter Bar Visual Design

**Files**:
- `components/scheduling/SectionFilters.tsx`
- `stores/sections.store.ts`

**Current State**: Search input + 4 dropdowns + status toggle + view toggle.

**Changes**:
- Consolidate into a single search bar with filter chips that expand on click
- Search input: full width, placeholder "Search sections by name, course, or teacher..."
- Filter chips: "Course", "Teacher", "Year", "Status" — each opens a dropdown popover on click
- Active filters shown as dismissible chips below the search bar
- View toggle (grid/list) stays as icon buttons, right-aligned
- Clear all filters link when any filter is active
- Mobile: filters collapse into a "Filters" button that opens a bottom sheet

**Validation**: All filters work correctly. Clearing filters resets view. Mobile responsive.

---

### Task 1.4: Persist Filter State in URL Search Params

**Files**:
- `routes/classrooms/index.tsx`
- `stores/sections.store.ts`
- `components/scheduling/SectionFilters.tsx`

**Changes**:
- Sync filter state to URL search params (`?course=X&teacher=Y&status=active&view=grid`)
- On page load, initialize Zustand store from URL params
- On filter change, update both Zustand and URL
- Direct link to filtered view works (e.g., share URL with filters applied)

**Validation**: URL reflects filter state. Sharing URL preserves filters. Browser back/forward works with filter changes.

---

### Task 1.5: Improve List View for Sections

**Files**:
- `components/scheduling/SectionTable.tsx` (existing)
- `routes/classrooms/index.tsx`

**Changes**:
- Proper table with columns: Section Name, Course, Teacher, Enrollment (progress), Room, Status, Actions
- Sortable columns (name, course, enrollment)
- Compact rows with hover highlight
- Same filters apply to both grid and list views
- Infinite scroll pagination works in list view

**Validation**: Toggle between grid/list preserves filter state. Table sorts correctly. Pagination loads more rows. Empty state when no results.

---

### Task 1.6: Improve Tab Navigation & Page Header

**File**: `routes/classrooms/index.tsx`

**Changes**:
- Breadcrumb: "Home > Academics > Classrooms" — muted links, chevron separators
- Page title: "Classrooms" — text-2xl font-bold, remove icon
- Subtitle: "Manage your classes, grades, and attendance in one place" — text-sm muted
- Tabs: underline indicator style (not pill), active tab = bold + teal underline
- Tab content transitions: subtle fade (Framer Motion, 150ms)
- Tab state persists in URL (`?tab=overview`)

**Validation**: Breadcrumb links navigate correctly. Tab switching smooth. URL reflects active tab. Direct link to tab works.

---

### Task 1.7: Verify Section Creation Flow Post-Redesign

**Files**: `components/classrooms/CreateMenu.tsx`, `routes/classrooms/create.tsx`

**Changes**:
- Verify "+ New Section" button (from Task 1.1) navigates to create form
- Verify create section form still works after overview page changes
- Verify created section appears in the list/grid after creation

**Validation**: Full create-section flow works: click create → fill form → save → section appears in list. No regression.

---

## Sprint 2: Classroom Detail Page — People Tab Overhaul

**Goal**: Transform the People tab into a clean, professional student roster with DiceBear avatars, proper table layout, and intuitive actions.

**Demoable Outcome**: Clicking into a classroom section shows a polished People tab with avatar-enhanced student table, proper columns, and enrollment management.

---

### Task 2.1: Create Unified Avatar Component with Initials Fallback

**Files**:
- `lib/avatar.ts` (existing DiceBear integration)
- New: `components/common/UserAvatar.tsx`

**Current State**: People tab uses a generic icon for students. ClassroomCard uses `getStaffAvatar()` as raw `<img>` with no fallback.

**Changes**:
- Create a reusable `UserAvatar` component (used for both students and staff)
- Props: `userId`, `userName`, `role` ('student' | 'staff'), `size` ('sm' | 'md' | 'lg'), `className`
- Primary: DiceBear avatar seeded by `userId` (students: 'avataaars', staff: 'lorelei')
- Fallback: Circular div with user initials (first letter of first + last name), background color derived from name hash
- Error handling: `onError` → show initials fallback
- Sizes: sm (24px), md (32px), lg (40px)
- Replace raw `<img>` usage in `ClassroomCard.tsx` with new component

**Validation**: Avatar renders for all students and teachers. Fallback shows initials when image fails. Colors consistent for same user across views. No flicker on load. ClassroomCard teacher avatar uses new component.

---

### Task 2.2: Redesign People Tab as a Proper Data Table

**File**: `components/scheduling/SectionRoster.tsx`

**Current State**: Simple list with student name, number, grade level badge, enrolled date, delete button.

**Changes**:
- Replace list with a proper table (shadcn/ui Table or custom):
  - **Avatar + Name** (UserAvatar + full name, left-aligned)
  - **Student ID** (student number, monospace)
  - **Grade Level** (badge, centered)
  - **Enrolled Date** (formatted, e.g., "Feb 19, 2026")
  - **Status** (Active/Dropped indicator)
  - **Actions** (dropdown: View Profile, Remove from Section)
- Sticky table header on scroll
- Subtle row dividers for readability
- Sort by: Name (default), Grade Level, Enrolled Date
- Search/filter within roster (name or student ID)
- Compact capacity header: "13/30 enrolled" + slim progress bar (green/amber/red at thresholds) + "Add Students" button

**Validation**: Table renders all enrolled students. Sorting works. Search filters in real-time. Remove action shows confirmation dialog. Empty state when no students. Capacity bar color-codes correctly.

---

### Task 2.3: Improve Student Selector Modal

**File**: `components/common/StudentSelector.tsx`

**Changes**:
- Search-first UI: large search input at top
- Show available students (not already enrolled in this section)
- Student rows: UserAvatar + name + student ID + grade level
- Multi-select with checkboxes
- "Enroll Selected (N)" button at bottom
- Loading/empty states
- Dismiss on successful enrollment with toast notification

**Validation**: Search finds students correctly. Already-enrolled students excluded. Multi-enrollment works. Toast confirms success.

---

## Sprint 3: Classwork Tab — Backend Implementation

**Goal**: Build the backend service for Classwork CRUD. This sprint focuses on backend only — frontend integration is Sprint 3B.

**Demoable Outcome**: Classwork API endpoints are live: create/read/update/delete classwork items and topics via API. Verified with smoke tests.

**Depends on**: Sprint 0 (entity design, shared-types)

---

### Task 3.1: Build Classwork Service — Topics & Read Path

**Files**:
- New: `server/application/microservices/academics/src/classwork/classwork.service.ts`
- New: `server/application/microservices/academics/src/classwork/classwork.module.ts`

**Changes**:
- Create `ClassworkModule` with DynamoDB + Events + Identity service providers
- Service methods:
  - `createTopic(dto)` → Create topic with auto-incrementing sort order
  - `getClassworkItems(sectionId, schoolId)` → Query GSI1 for section's items + topics, sort in-memory by topic/item sortOrder, group by topic
- Register `ClassworkModule` in `AcademicsModule` (import in `academics.module.ts`)

**Definition of Done**: Unit tests for both methods (mock DynamoDB client). Module registers without errors. Tests pass.

---

### Task 3.2: Build Classwork Service — Item CRUD

**Files**:
- Update: `server/application/microservices/academics/src/classwork/classwork.service.ts`

**Changes**:
- `createClassworkItem(dto)` → Create item, validate topic exists if topicId provided, set assignmentId = itemId for grade bridge
- `updateClassworkItem(itemId, dto)` → Update with optimistic locking (version condition)
- `deleteClassworkItem(itemId, schoolId)` → Hard delete

**Definition of Done**: Unit tests for all methods including optimistic locking failure case. Mock DynamoDB client + identity client service.

---

### Task 3.3: Build Classwork Service — Topic CRUD & Reorder

**Files**:
- Update: `server/application/microservices/academics/src/classwork/classwork.service.ts`

**Changes**:
- `updateTopic(topicId, dto)` → Rename topic with optimistic locking
- `deleteTopic(topicId, schoolId)` → Delete topic, unassign items (set topicId = null)
- `reorderItems(items[])` → BatchWriteItem to update sortOrder on multiple items/topics

**Definition of Done**: Unit tests for all methods. Delete cascades correctly. Reorder handles partial batch failure.

---

### Task 3.4: Add Classwork Event Publishing

**Files**:
- Update: `server/application/microservices/academics/src/common/services/academics-events.service.ts`
- Update: `server/application/microservices/academics/src/classwork/classwork.service.ts`

**Changes**:
- Add events to AcademicsEventsService:
  - `ClassworkItemCreated`, `ClassworkItemUpdated`, `ClassworkItemDeleted`
  - `ClassworkTopicCreated`, `ClassworkTopicUpdated`, `ClassworkTopicDeleted`
- Fire-and-forget pattern (`.catch(err => logger.error(...))`) matching existing conventions
- Wire events into service methods

**Definition of Done**: Events fire on CRUD operations. Errors logged but don't fail the request.

---

### Task 3.5: Build Classwork Controller & API Gateway Routes

**Files**:
- New: `server/application/microservices/academics/src/classwork/classwork.controller.ts`
- Update: `server/lib/tenant-api-prod.json`

**Changes**:
- Controller with `@UseGuards(JwtAuthGuard)`, `@TenantCredentials()`, `buildContext()`:
  ```
  POST   /academics/classwork                    → createClassworkItem
  GET    /academics/classwork?sectionId&schoolId  → getClassworkItems
  PATCH  /academics/classwork/{itemId}            → updateClassworkItem
  DELETE /academics/classwork/{itemId}            → deleteClassworkItem
  POST   /academics/classwork/topics              → createTopic
  PATCH  /academics/classwork/topics/{topicId}    → updateTopic
  DELETE /academics/classwork/topics/{topicId}    → deleteTopic
  PATCH  /academics/classwork/reorder             → reorderItems
  ```
- Add all routes to API Gateway config with x-amazon-apigateway-integration

**Definition of Done**: API gateway config is valid JSON. API returns 401 without auth. Smoke test CRUD flow with valid token.

---

### Task 3.6: Classwork API Smoke Test

**File**: New: `scripts/smoke-tests/classwork-crud.ts`

**Changes**:
- Smoke test script:
  1. Create topic → verify 201
  2. Create classwork item in topic → verify 201
  3. Get section classwork → verify item appears grouped under topic
  4. Update item title → verify 200
  5. Delete item → verify 200
  6. Delete topic → verify items unassigned
- Follow existing smoke test patterns

**Validation**: Script runs against dev environment. All assertions pass.

---

## Sprint 3B: Classwork Tab — Frontend Integration

**Goal**: Replace mock data with real backend API. Build the create/edit drawer and topic management UI.

**Demoable Outcome**: Teachers can create topics, add assignments/materials/quizzes, view them grouped by topic, edit and delete items — all backed by real API.

**Depends on**: Sprint 3 (backend API)

---

### Task 3B.1: Frontend API Service + React Query Hooks

**Files**:
- Update: `edforge-saas-frontend/apps/academics/src/services/academics.service.ts`
- New: `edforge-saas-frontend/apps/academics/src/hooks/useClasswork.ts`

**Changes**:
- API functions: `getClassworkItems()`, `createClassworkItem()`, `updateClassworkItem()`, `deleteClassworkItem()`, `createTopic()`, `updateTopic()`, `deleteTopic()`, `reorderItems()`
- All API calls include `schoolId` parameter
- React Query hooks:
  - `useClassworkItems(sectionId, schoolId)` → Query
  - `useCreateClassworkItem()` → Mutation (invalidates classwork query)
  - `useUpdateClassworkItem()` → Mutation
  - `useDeleteClassworkItem()` → Mutation
  - `useCreateTopic()` / `useUpdateTopic()` / `useDeleteTopic()` → Mutations
- Import shared types from `@edforge/shared-types`

**Validation**: Hooks return correct data shape. Mutations invalidate cache. Loading/error states handled.

---

### Task 3B.2: Replace Mock Data in ClassworkFeed

**Files**:
- `components/classrooms/classwork/ClassworkFeed.tsx`
- `hooks/useClassworkItems.ts` (replace mock hook)

**Changes**:
- Replace mock `useClassworkItems()` with real API hook
- Wire ClassworkFeed to `useClassworkItems(sectionId, schoolId)`
- Loading state: skeleton
- Empty state: "No classwork yet. Create your first assignment."
- Error state: retry button
- Group items by topicId, with "Other" bucket for unassigned items

**Validation**: Real backend data renders correctly. Empty section shows empty state. Topics group correctly.

---

### Task 3B.3: Build Create/Edit Classwork Drawer

**Files**:
- New: `components/classrooms/classwork/ClassworkDrawer.tsx`
- Update: `components/classrooms/classwork/ClassworkCreateMenu.tsx`

**Changes**:
- Slide-over drawer (independent of AssignmentEditor — different data model):
  - Type selector: Assignment / Quiz / Material / Question (icon + label chips)
  - Title (required)
  - Description (textarea)
  - Topic (dropdown + "Create new topic" inline option)
  - Due Date (date picker, optional for materials)
  - Points Possible (number input, hidden for materials/questions)
  - Category (links to grading policy categories, for grade bridge)
  - Assessment Purpose (formative/summative)
  - Status: Draft / Published toggle
  - Attachments area (placeholder for future)
- iOS-style fluid slide-in animation (Framer Motion)
- Discard confirmation if form dirty
- Edit mode: pre-fill form, "Save Changes" button
- Delete action in edit mode with confirmation
- Zod form validation (title required, possiblePoints > 0 if present)

**Validation**: Drawer opens/closes smoothly. Create saves item and refreshes list. Edit updates item. Delete removes item. Draft badge shows.

---

### Task 3B.4: Topic Management UI

**Files**:
- `components/classrooms/classwork/TopicSection.tsx`
- `components/classrooms/classwork/ClassworkFeed.tsx`

**Changes**:
- "Create Topic" button in ClassworkCreateMenu
- Inline topic creation: text input + save button
- Topic header: collapsible with chevron, title, item count
- Topic actions menu: Rename, Delete, Move Up/Down
- Rename: inline edit mode on header
- Delete: confirmation dialog, items get unassigned (moved to "Other")
- Up/Down arrows for reorder (no drag-and-drop in MVP)

**Validation**: Topics CRUD works. Collapse/expand works. Reorder persists. Delete unassigns items.

---

### Task 3B.5: Classwork Item Card Enhancement

**Files**:
- `components/classrooms/classwork/ClassworkItemCard.tsx`

**Changes**:
- Click card → opens ClassworkDrawer in edit mode
- Card shows: type icon (color-coded), title, due date, points, attachment count
- Status badge: draft=amber, published=default (no badge), scheduled=blue
- Hover state: subtle highlight

**Validation**: Click opens edit drawer with correct data. All item types render with correct icons. Status badges display correctly.

---

## Sprint 4: Progress Tab — Merge Grades & Attendance

**Goal**: Combine the Grades and Attendance tabs into a single "Progress" tab. Reduce cognitive load for teachers.

**Demoable Outcome**: A single "Progress" tab replaces separate Grades and Attendance tabs with a summary dashboard and drill-down sub-views.

---

### Task 4.1: Update Tab Type Definition & Create Progress Container

**Files**:
- Update: `routes/classrooms/$sectionId.tsx` (update `ClassroomDetailTab` type and `TABS` array)
- New: `components/classrooms/progress/ProgressTab.tsx`

**Changes**:
- Update TypeScript type from `'stream' | 'classwork' | 'people' | 'grades' | 'attendance'` to `'stream' | 'classwork' | 'people' | 'progress'`
- Update `TABS` array: remove grades/attendance entries, add progress entry
- Tab order: Stream, Classwork, People, Progress
- ProgressTab with internal segmented control sub-navigation:
  - **Overview** (default): Summary dashboard
  - **Gradebook**: Existing GradebookGrid
  - **Attendance**: Existing SectionAttendanceWrapper
- URL param: `?tab=progress&view=overview|gradebook|attendance`
- Add URL redirects: `?tab=grades` → `?tab=progress&view=gradebook`, `?tab=attendance` → `?tab=progress&view=attendance`

**Validation**: Tab navigation works. 4 tabs visible. Old URLs redirect correctly. Sub-views render.

---

### Task 4.2: Build Grade Summary Card

**Files**:
- New: `components/classrooms/progress/ProgressOverview.tsx`
- New: `components/classrooms/progress/GradeSummaryCard.tsx`

**Changes**:
- Two-column layout container in ProgressOverview
- GradeSummaryCard:
  - Class average (numeric + letter grade)
  - Grade distribution bar (A/B/C/D/F segments, stacked horizontal)
  - Recent assignments: last 3 with class average
  - "Open Gradebook" button → switches to gradebook sub-view
- Handle empty state (no grades recorded yet)

**Validation**: Card renders with real grade data. Distribution bar correct. Empty state shows when no grades.

---

### Task 4.3: Build Attendance Summary Card

**Files**:
- New: `components/classrooms/progress/AttendanceSummaryCard.tsx`

**Changes**:
- Today's attendance: present/absent/late counts with compact visual
- Weekly attendance rate percentage
- Students with attendance alerts (>3 absences this month)
- "Open Attendance" button → switches to attendance sub-view
- Handle empty state (no attendance recorded)

**Validation**: Card renders with real attendance data. Alert count correct. Empty state shows appropriately.

---

### Task 4.4: Build At-Risk Students Section

**Files**:
- Update: `components/classrooms/progress/ProgressOverview.tsx`

**Changes**:
- Section below summary cards
- Lists students with low grades (<70%) OR poor attendance (<85%)
- Compact rows: UserAvatar, name, grade, attendance rate, risk indicator
- Handle empty state ("All students on track")
- Unit tests for the at-risk filter logic (edge cases: 0 students, no grades, no attendance)

**Validation**: At-risk list filters correctly. Empty state works. Edge cases handled (verified by unit tests).

---

### Task 4.5: Migrate Gradebook Grid into Progress Tab

**Files**:
- `components/classrooms/progress/ProgressTab.tsx`
- `components/grades/GradebookGrid.tsx` (reuse as-is)

**Changes**:
- When sub-view is "gradebook", render existing `GradebookGrid`
- Extract local state from `SectionGradesTab` in `$sectionId.tsx` (selectedTermId, showBulkModal, showFinalize, showAssignmentEditor) into the Progress gradebook sub-view
- Ensure Record, Finalize, AssignmentEditor drawer all work within Progress context
- **Regression checklist**: inline editing, add assignment, bulk grade, finalize, report card link

**Validation**: All gradebook features work identically to the old standalone Grades tab. No regressions.

---

### Task 4.6: Migrate Attendance Grid into Progress Tab

**Files**:
- `components/classrooms/progress/ProgressTab.tsx`
- `components/attendance/SectionAttendanceWrapper.tsx` (reuse as-is)

**Changes**:
- When sub-view is "attendance", render existing `SectionAttendanceWrapper`
- **Regression checklist**: date navigation, bulk entry, keyboard shortcuts (P/A/L/E/R), offline resilience, correction workflow

**Validation**: All attendance features work identically. Keyboard shortcuts work. Offline support works.

---

### Task 4.7: Update StreamFeed Quick Actions & Internal Links

**Files**:
- `components/classrooms/stream/StreamFeed.tsx`
- Any other components referencing `onSwitchTab('grades')` or `onSwitchTab('attendance')`

**Changes**:
- Update StreamFeed quick action buttons to use `onSwitchTab('progress')` with appropriate view param
- "Take Attendance" → navigates to `?tab=progress&view=attendance`
- "Open Gradebook" → navigates to `?tab=progress&view=gradebook`
- Search entire codebase for any other references to old tab IDs

**Validation**: Quick actions navigate to correct Progress sub-views. No broken links anywhere.

---

### Task 4.8: Progress Tab Transitions & Loading States

**Files**:
- `components/classrooms/progress/ProgressTab.tsx`
- `components/classrooms/progress/ProgressOverview.tsx`

**Changes**:
- Framer Motion transitions between sub-views (subtle slide)
- Loading skeleton for overview dashboard
- Error boundary per sub-view
- Lazy-load gradebook and attendance (heavy components)

**Validation**: Smooth transitions. No layout shift. Error isolation works.

---

## Sprint 5: Classroom Detail Page — Header & Polish

**Goal**: Polish the classroom detail page header and overall UX. Cross-tab consistency audit.

**Demoable Outcome**: A polished, cohesive classroom detail page ready for production.

---

### Task 5.1: Redesign Classroom Detail Header Banner

**File**: `routes/classrooms/$sectionId.tsx`

**Changes**:
- Reduce banner height (~200px → ~120px)
- Section name: large bold white text
- Course + Teacher: single line, muted white text
- Enrollment + Room: compact chips at bottom-right
- Status badge: small pill top-right
- Darker gradient overlay on cover image for better text contrast
- Mobile: stack metadata below title

**Validation**: Text readable against all 11 subject-area covers. Responsive layout works. Actions menu functional.

---

### Task 5.2: Improve Detail Page Tab Bar

**File**: `routes/classrooms/$sectionId.tsx`

**Changes**:
- 4 tabs: Stream, Classwork, People, Progress (each with icon + label)
- Active tab: colored underline + bold text
- Tab bar sticky below header on scroll
- Smooth underline animation on tab switch

**Validation**: Sticky works. Icons render. Animation smooth.

---

### Task 5.3: Polish Stream Tab with Preview Banner

**Files**:
- `components/classrooms/stream/StreamFeed.tsx`
- `components/classrooms/stream/PostComposer.tsx`
- `components/classrooms/stream/StreamPostCard.tsx`

**Changes**:
- Add subtle "Preview" banner: "Stream is in preview. Posts are not saved."
- PostComposer: clean card with avatar + "Share something with your class..." placeholder
- Quick actions: "Take Attendance", "Open Gradebook" → link to Progress sub-views (verified in Task 4.7)
- Clean up existing UI: consistent spacing, typography
- Note: Stream remains mock data — backend is future work

**Validation**: Preview banner visible. Quick actions navigate correctly. UI is clean.

---

### Task 5.4: Cross-Tab Consistency Audit & Cleanup

**Files**: All classroom-related components

**Changes**:
- Consistent padding (p-6) across all tab content
- Consistent empty/loading/error state patterns
- Consistent primary button color (teal)
- Typography follows design system scale
- Remove dead code, unused imports, TODO comments
- Verify dark mode rendering for all changed components

**Validation**: Visual review of all 4 tabs. No console warnings/errors. Dark mode renders correctly.

---

## Sprint 6: Overview Page Tab Consolidation & Responsive Design

**Goal**: Bring the overview page (`/classrooms`) in line with the detail page's consolidated design. Address responsive/tablet UX.

**Demoable Outcome**: Overview page tabs are cleaner and consistent with the detail page. All features work on tablet.

---

### Task 6.1: Evaluate Overview Page Tab Consolidation

**File**: `routes/classrooms/index.tsx`

**Current State**: Overview page has 4 tabs: Overview, Gradebook, Grading Policies, Attendance Board.
**Detail page** now has: Stream, Classwork, People, Progress.

**Decision**: The overview page tabs serve a different purpose (school-wide views vs section-specific). Document the rationale for keeping them separate OR consolidate. If keeping separate:
- Rename "Attendance Board" → "Attendance" for consistency
- Ensure visual tab style matches detail page (underline indicator)

**Validation**: Documented decision. Tab styles consistent between overview and detail pages.

---

### Task 6.2: Tablet & Mobile Responsive Audit

**Files**: All classroom components

**Changes**:
- Gradebook grid: horizontal scroll with frozen student name column on tablet
- Attendance grid: verified tablet usability
- Section cards: 2-column on tablet, 1-column on mobile
- People table: responsive layout (collapse less-important columns on mobile)
- ClassworkDrawer: full-width on mobile
- Progress overview: single-column stack on mobile

**Validation**: Test on iPad-sized viewport (768px) and mobile (375px). All features usable. No horizontal overflow.

---

## Sprint 7: Security, Accessibility, Performance & Production Hardening

**Goal**: Production-grade security, accessibility, performance, and resilience.

**Demoable Outcome**: All features pass security review, accessibility audit, and performance benchmarks.

---

### Task 7.1: Permission Guard Audit

**Files**: All classwork + classroom controllers + frontend components

**Changes**:
- Verify every backend endpoint has `@UseGuards(JwtAuthGuard)`
- Verify data scope on classwork queries (teacher sees only their sections unless admin)
- Frontend: `useResourcePermissions()` gates create/edit/delete
- Test: teacher cannot access another teacher's classwork
- Document permission matrix

**Validation**: 403 for unauthorized users. Frontend hides unauthorized actions.

---

### Task 7.2: Input Validation & XSS Prevention

**Files**: All DTOs, form schemas

**Changes**:
- Backend: class-validator decorators on all Classwork DTOs (MaxLength, IsUUID, IsEnum)
- Frontend: Zod schemas with constraints
- Sanitize text inputs (classwork titles/descriptions)
- Grade inputs: validate numeric range (0-999), possiblePoints > 0

**Validation**: Malformed API data returns 400. Frontend validation catches bad input.

---

### Task 7.3: Accessibility Audit

**Files**: All classroom components

**Changes**:
- Keyboard navigation: all tabs, tables, drawers
- Tables: proper `<thead>`, `<tbody>`, `<th scope="col">`
- Icon-only buttons: `aria-label`
- All form inputs: associated labels
- Color contrast: WCAG AA (4.5:1)
- Focus management: drawer open/close
- Grade color coding: not color-only (include text)

**Validation**: Keyboard-only navigation works. VoiceOver announces all elements. No color-only information.

---

### Task 7.4: Performance Optimization

**Changes**:
- Gradebook: virtualize rows if roster > 50 students
- Classwork: collapse topics by default
- Verify lazy-loading works for Progress sub-views
- Verify React Query dedup (no duplicate fetches)
- Profile with React DevTools: no unnecessary re-renders

**Validation**: Gradebook handles 60+ students smoothly. Section list handles 200+ sections.

---

### Task 7.5: Error Handling & Edge Cases

**Changes**:
- Empty section (0 students): all tabs handle gracefully
- Max enrollment reached: Add Students button disabled with tooltip
- Network error: toast with retry
- Concurrent edit conflict (version mismatch): conflict toast + refresh
- Long names: text truncation with tooltip
- Special characters: renders correctly

**Validation**: Manual test each edge case. No crashes. Clear user feedback.

---

### Task 7.6: Classrooms E2E Smoke Test

**File**: New: `scripts/smoke-tests/classrooms-e2e.ts`

**Changes**:
- Full flow:
  1. List sections
  2. Open detail page
  3. Switch between all 4 tabs
  4. People: verify roster loads
  5. Classwork: create topic, create assignment
  6. Progress > Gradebook: record a grade
  7. Progress > Attendance: record attendance
  8. Verify data persists on reload

**Validation**: Script runs against dev environment. All assertions pass.

---

## Sprint Summary

| Sprint | Goal | Key Deliverables |
|--------|------|-----------------|
| **0** | Data Model Design | Classwork-Grade bridge ADR, entity design, shared-types schemas |
| **1** | Overview Page Polish | Redesigned stats, cards, filters, list view |
| **2** | People Tab Overhaul | Unified avatar component, data table, student selector |
| **3** | Classwork Backend | DynamoDB entity, CRUD service, controller, API routes, smoke test |
| **3B** | Classwork Frontend | Real API hooks, classwork drawer, topic management |
| **4** | Progress Tab | Unified tab, summary dashboard, at-risk students, Grades+Attendance migration |
| **5** | Detail Page Polish | Refined header, Stream preview, cross-tab consistency, dark mode |
| **6** | Overview Consolidation | Overview page tab alignment, tablet/mobile responsive audit |
| **7** | Production Hardening | Security, a11y, performance, edge cases, E2E smoke test |

---

## Architecture Decisions

1. **Classwork as separate entity** (not embedded in Grade): Classwork items exist independently of grades. A material or question in Classwork has no grade. This allows Classwork to serve as content management while Grades remains the scoring system. The `itemId` on Classwork becomes the `assignmentId` on `AssignmentGrade` for graded items (bridge pattern from Task 0.1).

2. **GSI sort key uses stable IDs** (not sort order): Sort order stored as a regular attribute to avoid expensive delete+put operations on reorder. In-memory sorting is fine for <200 items per section.

3. **Progress tab with segmented control** (not nested tabs): Avoids tabs-within-tabs anti-pattern. Segmented control communicates "same context, different view."

4. **Layout migration for Gradebook/Attendance** (not rewrite): Existing components are battle-tested. Moving them into Progress is a composition change, minimizing regression risk.

5. **Unified UserAvatar component**: Single avatar component for both students and staff with DiceBear + initials fallback. Replaces disparate avatar implementations.

6. **Mock data for Stream**: Stream requires significant backend (real-time posts, comments, notifications). Polished preview maintains UI vision without blocking sprint.

7. **Backend before frontend for Classwork**: Sprint 3 (backend) and 3B (frontend) are separated to allow backend stabilization before frontend depends on it.

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Classwork-to-Grade bridge complexity | High | Task 0.1 settles architecture before any code. ADR reviewed. |
| Grades/Attendance migration regression | High | Tasks 4.5/4.6 include explicit regression checklists. Local state extraction carefully tested. |
| Reorder with BatchWriteItem partial failure | Medium | Task 3.3 handles partial failure. Sort order stored as attribute, not GSI key. |
| URL filter persistence breaking navigation | Medium | Task 1.4 separated from visual redesign. Tested with browser back/forward. |
| Stream quick actions breaking after tab rename | Low | Task 4.7 explicitly searches codebase for all old tab ID references. |
| Dark mode rendering for new components | Low | Task 5.4 includes dark mode verification. |
