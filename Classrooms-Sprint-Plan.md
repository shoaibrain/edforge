# Classrooms Module — Sprint Plan

## Vision

Evolve the EdForge Scheduling page into a **Google Classroom-inspired** "Classrooms" experience at the **presentation layer only**. The Section entity is the convergence point between the administrative world (Ed-Fi/EMIS scheduling, enrollment, curriculum) and the instructional world (LMS/classroom experience).

**What changes:** Routes, navigation, components, and UI terminology in the academics frontend module.
**What stays the same:** All backend services, DynamoDB schema, API contracts, shared types, ABAC permissions, and business logic.

## Route Mapping

| Old Route | New Route | Notes |
|-----------|-----------|-------|
| `/academics/scheduling` | `/academics/classrooms` | Unified classroom list |
| `/academics/scheduling/$sectionId` | `/academics/classrooms/$sectionId` | Classroom detail (tabs) |
| `/academics/grades` | `/academics/classrooms?tab=gradebook` | Absorbed into classrooms |
| `/academics/attendance` | `/academics/classrooms?tab=attendance` | Absorbed into classrooms |
| `/academics/students` | `/academics/students` | **Unchanged** |
| `/academics/curriculum` | `/academics/curriculum` | **Unchanged** |

## Sidebar (Final State)

```
Academics
├── Overview         → /academics
├── Students         → /academics/students
├── Classrooms       → /academics/classrooms    ← NEW (consolidated)
└── Curriculum       → /academics/curriculum
```

## Current State Assessment

**Already done:**
- Sidebar updated to 4 items (Overview, Students, Classrooms, Curriculum)
- Router configured: `/classrooms` and `/classrooms/$sectionId`
- Classrooms index page with 5 tabs (My Classes, Overview, Gradebook, Grading Policies, Attendance Board)
- Classroom detail page with 5 tabs (Stream, Classwork, People, Grades, Attendance)
- Stream and Classwork stub placeholders
- MigrationNotice component
- Legacy `/scheduling` route still exists

**Remaining work:**
- Delete SectionDrawer, replace with full-page create/edit flow or inline modal
- Transform section list from table to Google Classroom-style card grid
- Build Lexical editor foundation (reusable shared package: `@edforge/editor`)
- Implement Stream tab with posts feed using Lexical
- Implement Classwork tab with assignment/material stubs
- Clean up legacy routes and dead code
- Polish classroom detail header to match Google Classroom style
- Fix section-scoped attendance tab (currently loads school-wide — must filter by section roster)
- Add class code concept to section display
- Add "Create" button (Google Classroom-style `+ Create` dropdown)

## Design Decisions

**Tab history behavior:** Tab changes use `replace: true` in `navigate()`, meaning browser back/forward skips tab switches and goes to the previous *page*. This matches the behavior of tabbed interfaces in Google Workspace products.

**Default detail page tab:** The classroom detail page defaults to `'stream'` once the Stream tab is implemented (Sprint 4). Until then, defaults to `'people'`.

**Mock data strategy:** Stream and Classwork features use hook-based data providers (`useStreamPosts(sectionId)`, `useClassworkItems(sectionId)`) that return mock data internally. When backend APIs are ready, the hook implementation swaps from mock to React Query with zero component changes.

---

## Sprint 1: Route Restructure, SectionDrawer Removal & Section Create/Edit

**Goal:** Restructure the classrooms route tree for type safety, remove the SectionDrawer, introduce full-page section create/edit, fix section-scoped attendance, clean up all legacy routes, and ensure zero regression. The app should be fully navigable via `/classrooms` with no dead links.

**Demo:** Navigate to `/academics/classrooms`, see "My Classes" tab, click a section to go to detail page, use "Edit Section" from actions dropdown (navigates to edit page instead of drawer), create new section via full-page create flow. Old routes redirect to `/classrooms`. Attendance tab on detail page shows only section roster students.

### Tickets

#### S1-T1: Restructure classrooms route tree with nested routes
**File:** `apps/academics/src/router.tsx`
**What:** Restructure the classrooms routes as a nested route tree to prevent the dynamic `$sectionId` route from swallowing static routes like `/create` and `/report-card`:

```typescript
const classroomsLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/classrooms',
  component: () => <Outlet />,  // passthrough
})

const classroomsIndexRoute = createRoute({
  getParentRoute: () => classroomsLayoutRoute,
  path: '/',
  component: ClassroomsModule,
  validateSearch: (search) => ({
    tab: z.enum(['my-classes','overview','gradebook','policies','attendance']).catch('my-classes').parse(search.tab),
  }),
})

const classroomsCreateRoute = createRoute({
  getParentRoute: () => classroomsLayoutRoute,
  path: '/create',
  component: SectionCreatePage,
})

const reportCardRoute = createRoute({
  getParentRoute: () => classroomsLayoutRoute,
  path: '/report-card',
  component: ReportCardPage,
})

const classroomDetailRoute = createRoute({
  getParentRoute: () => classroomsLayoutRoute,
  path: '/$sectionId',
  component: ClassroomDetailPage,
  validateSearch: (search) => ({
    tab: z.enum(['stream','classwork','people','grades','attendance']).catch('people').parse(search.tab),
  }),
})

const classroomEditRoute = createRoute({
  getParentRoute: () => classroomDetailRoute,
  path: '/edit',
  component: SectionEditPage,
})
```

Also add `beforeLoad` redirects for legacy paths:
- `/scheduling` → `redirect({ to: '/classrooms' })`
- `/scheduling/$sectionId` → `redirect({ to: '/classrooms/$sectionId' })`
- `/grades` → `redirect({ to: '/classrooms', search: { tab: 'gradebook' } })`
- `/attendance` → `redirect({ to: '/classrooms', search: { tab: 'attendance' } })`
- `/attendance/dashboard` → `redirect({ to: '/classrooms', search: { tab: 'attendance' } })`

Audit all other legacy routes (`/schedules`, `/timetables`, `/gradebooks`, `/assessments`, `/exams`). For each unreachable from sidebar, either add a redirect or remove entirely.

**Acceptance:**
- Static routes (`/create`, `/report-card`) resolve correctly, not swallowed by `$sectionId`
- `validateSearch` provides type-safe tab params (no more `as { tab?: string }` casts)
- All legacy routes redirect correctly
- `useSearch()` returns typed tab values without `as any`
- Build passes
**Validation:** Navigate to `/classrooms/create` — see create page (not "Section Not Found"). Navigate to legacy URLs — all redirect. TypeScript shows no `as any` for search params.

#### S1-T2: Remove SectionDrawer from classrooms index page
**Files:**
- `apps/academics/src/routes/classrooms/index.tsx`
**What:** Remove all `SectionDrawer` imports and usage. Remove `drawerOpen`, `drawerMode`, `selectedSection` state and all drawer handler functions. The "Add Section" action should now navigate to `/classrooms/create`. Remove the `SectionDrawer` render at bottom of both `ClassroomsModule` and `MyClassesTab`. Remove the `openViewDrawer` handler — row clicks should only use `handleViewRoster` (navigate to detail page). Update `useSearch` to use the new typed search params from `validateSearch` instead of `as { tab?: string }`.
**Acceptance:**
- No SectionDrawer renders anywhere on the classrooms index page
- "Add Section" navigates to `/classrooms/create`
- Section row click navigates to `/classrooms/$sectionId`
- `useSearch` uses typed params
- Build passes with no unused import warnings
**Validation:** Visual check — no slide-over drawer appears. Build check.

#### S1-T3: Remove SectionDrawer from classroom detail page
**Files:**
- `apps/academics/src/routes/classrooms/$sectionId.tsx`
**What:** Remove `SectionDrawer` import and usage. "Edit Section" in `ActionsDropdown` navigates to `/classrooms/$sectionId/edit`. Remove `drawerOpen` state and `SectionDrawer` render. Update `useSearch` to use typed params from `validateSearch`.
**Acceptance:**
- No SectionDrawer on detail page
- "Edit Section" navigates to edit page
- Typed search params
- Build passes
**Validation:** Visual check, build check.

#### S1-T4: Create section create page at `/classrooms/create`
**Files:**
- `apps/academics/src/routes/classrooms/create.tsx` (new)
- `apps/academics/src/router.tsx` (route already added in S1-T1)
**What:** Create a full-page section creation form. Page layout: back button to `/classrooms`, page title "Create Class Section", `SectionForm` in a card, Save/Cancel buttons.

**Critical:** `SectionForm` currently uses `useFormContext()` which requires a parent `<FormProvider>`. The create page must:
- Initialize `useForm<SectionFormData>({ resolver: zodResolver(sectionFormSchema), defaultValues })`
- Wrap `SectionForm` in `<FormProvider {...methods}>`
- Handle `handleSubmit` → call `useCreateSection` mutation
- Show success toast → navigate to `/classrooms/$newSectionId`
- Show error toast on failure
- Handle form dirty state: if user clicks Cancel with unsaved changes, show confirmation dialog

Reference `SectionDrawer` for the form reset/dirty-state patterns before it is deleted.

**Acceptance:**
- Full-page form at `/classrooms/create`
- Form validates via Zod schema
- Submit calls `createSection` API
- Success → navigate to new section detail
- Cancel with dirty form → confirmation dialog
- Loading and error states handled
**Validation:** Create a section, confirm it appears in list.

#### S1-T5: Create section edit page at `/classrooms/$sectionId/edit`
**Files:**
- `apps/academics/src/routes/classrooms/$sectionId.edit.tsx` (new)
- `apps/academics/src/router.tsx` (route already added in S1-T1)
**What:** Full-page edit form. Fetches section via `useSection`, pre-populates `SectionForm`, saves via `useUpdateSection`. Same `FormProvider` wrapping pattern as S1-T4.

**Must replicate from SectionDrawer:**
- Pre-populate form with `reset()` when section data loads
- Dirty state confirmation on Cancel
- Optimistic locking via `version` field
- Success/error toasts

**Acceptance:**
- Pre-populated form at `/classrooms/$sectionId/edit`
- Submit calls `updateSection` API
- Success → navigate back to detail page
- Handles version conflict
- Dirty state confirmation on cancel
**Validation:** Edit a section, confirm changes persist on detail page.

#### S1-T6: Delete SectionDrawer component files
**Files:**
- `apps/academics/src/components/scheduling/SectionDrawer.tsx` (delete)
- `apps/academics/src/components/scheduling/index.ts` (remove export)
**What:** Delete `SectionDrawer.tsx`. Remove export from barrel. Grep codebase for remaining imports and remove.
**Acceptance:**
- File deleted, no imports remain
- Build passes
**Validation:** `pnpm build`. `grep -r "SectionDrawer" apps/academics/src/` returns nothing.

#### S1-T7: Fix section-scoped attendance in classroom detail page
**Files:**
- `apps/academics/src/routes/classrooms/$sectionId.tsx`
- `apps/academics/src/components/attendance/SectionAttendanceWrapper.tsx` (new, if needed)
**What:** The current `SectionAttendanceTab` lazy-imports the full `AttendanceModule` which is school-wide, not section-scoped. This is a bug — the Attendance tab on a classroom detail page should show only students from that section's roster.

Create a section-scoped attendance wrapper that:
1. Fetches the section roster via `useSectionRoster(sectionId)`
2. Passes the roster student IDs as a filter to the attendance grid
3. Keeps all existing functionality (date selector, status toggles, bulk attendance)
4. Only shows students enrolled in this section

Replace the lazy `SectionAttendanceTab` with this wrapper.
**Acceptance:**
- Attendance tab shows only students in the current section's roster
- Date selector works
- Status toggles save via existing API
- Bulk attendance works for section students only
- No school-wide students leak into the section view
**Validation:** Navigate to a section with 5 students. Attendance tab shows exactly those 5, not the full school roster.

#### S1-T8: Extract TabErrorBoundary to shared component
**Files:**
- `apps/academics/src/components/common/TabErrorBoundary.tsx` (new)
- `apps/academics/src/routes/classrooms/index.tsx` (remove inline definition, import from common)
- `apps/academics/src/routes/classrooms/$sectionId.tsx` (remove inline definition, import from common)
**What:** The `TabErrorBoundary` class component and `TabError` function are copy-pasted in both classrooms pages. Extract to `components/common/TabErrorBoundary.tsx`. Also add a "Try Again" button that resets the error boundary state (`this.setState({ hasError: false })`).
**Acceptance:**
- Single source of truth for error boundary
- "Try Again" button resets the error state
- Both pages import from common
- Build passes
**Validation:** Trigger an error in a tab, see "Try Again" button, click it, confirm tab re-renders.

#### S1-T9: Clean up legacy route files and verify sidebar
**Files:**
- `apps/academics/src/routes/scheduling/index.tsx` (replace with redirect or delete)
- `apps/academics/src/routes/scheduling/$sectionId.tsx` (replace with redirect or delete)
- `apps/academics/src/routes/attendance/index.tsx` (keep exportable module, add redirect for standalone route)
- `apps/academics/src/routes/grades/index.tsx` (add redirect)
- `apps/shell/src/config/sidebar-modules.ts` (verify)
**What:** Since S1-T1 handles redirects via `beforeLoad`, the legacy route files can be simplified to empty shells or deleted. The `AttendanceModule` export from `routes/attendance/index.tsx` must be preserved since it's lazy-imported by the classrooms page. The `GradeOverview` from `routes/grades/overview.tsx` must also remain importable.

Verify sidebar: academics module shows exactly Overview, Students, Classrooms, Curriculum with correct permissions.
**Acceptance:**
- No standalone scheduling/grades/attendance UI reachable
- `AttendanceModule` and `GradeOverview` remain importable
- Sidebar correct
**Validation:** Manual navigation, build check, visual sidebar check.

#### S1-T10: End-to-end smoke test for Sprint 1
**What:** Manual walkthrough:
1. Navigate to `/academics/classrooms` — My Classes tab renders with section table
2. Click a section row → navigates to `/classrooms/$sectionId` detail page
3. Detail page tabs: Stream (stub), Classwork (stub), People (roster loads), Grades (gradebook loads), Attendance (section-scoped grid loads with only roster students)
4. "Edit Section" from detail actions → navigates to `/classrooms/$sectionId/edit` (full-page form, pre-populated)
5. "Add Section" from classrooms page → navigates to `/classrooms/create` (full-page form)
6. Create a section, confirm it appears in list
7. Edit a section, confirm changes persist
8. Record a grade in Grades tab, confirm it saves
9. Record attendance for a section student, confirm it saves
10. Navigate to `/classrooms/create` directly — renders create page, NOT "Section Not Found"
11. Legacy URLs: `/scheduling`, `/grades`, `/attendance` all redirect correctly
12. `TabErrorBoundary` "Try Again" button works
**Acceptance:** All 12 checks pass without errors.
**Validation:** Documented smoke test checklist.

---

## Sprint 2: Google Classroom-Style Card Grid & "Create" UX

**Goal:** Replace the tabular section list with a Google Classroom-style card grid. Each class appears as a visual card with course color band, teacher name, enrollment count, and quick-action icons. Implement the `+ Create` dropdown. Add grid/list view toggle so users can switch between card grid and table views.

**Demo:** Navigate to `/academics/classrooms`. See a responsive grid of classroom cards. Cards show a color banner, class name, teacher, enrollment, and a status dot. Clicking a card navigates to the detail page. `+ Create` dropdown shows "New Class Section" and greyed-out stubs. Toggle switches to table view for users who prefer it.

### Tickets

#### S2-T1: Create `ClassroomCard` component
**Files:**
- `apps/academics/src/components/classrooms/ClassroomCard.tsx` (new)
- `apps/academics/src/components/classrooms/index.ts` (update exports)
**What:** Build a `ClassroomCard` component that renders a section as a Google Classroom-style card:
- **Top:** Color band/gradient (derived from courseId hash) — 80px tall
- **Title area:** Section name (or `courseName - sectionNumber`), course code subtitle
- **Teacher line:** Teacher name with avatar placeholder (initials circle)
- **Bottom bar:** Enrollment count ("6 / 30 students"), capacity progress bar, Active/Inactive badge
- **Actions:** Three-dot menu (Edit → navigate to edit page, Deactivate) — only if `schedPerms.edit`. Use HeadlessUI `Menu` for keyboard accessibility.
- **Click:** `onClick` navigates to detail page
- Responsive: 1-col (mobile), 2-col (tablet), 3-col (desktop), 4-col (wide)
**Props:**
```typescript
interface ClassroomCardProps {
  section: SectionResponseDto
  onNavigate: (sectionId: string) => void
  onEdit?: (sectionId: string) => void
  onToggleActive?: (section: SectionResponseDto) => void
  colorIndex: number
}
```
**Acceptance:**
- Card renders section data correctly
- Click navigates to detail page
- Actions menu uses HeadlessUI `Menu` with keyboard support
- Color band varies per card
- Responsive at all breakpoints
**Validation:** Visual check at mobile/tablet/desktop widths.

#### S2-T2: Create color palette utility for classroom cards
**Files:**
- `apps/academics/src/lib/classroom-colors.ts` (new)
**What:** Deterministic mapping from `courseId` to a color from a palette of 8-10 gradients:
```typescript
export const CLASSROOM_COLORS: { gradient: string; accent: string; text: string; dark: { gradient: string; accent: string; text: string } }[]
export function getColorForCourse(courseId: string): typeof CLASSROOM_COLORS[number]
```
Simple hash: sum of char codes mod palette length. Colors harmonize with EdForge palette and work in both light and dark modes. Include both light and dark variants per color.
**Acceptance:**
- Same courseId always returns same color
- At least 8 distinct color options
- Light and dark mode variants provided
- Color contrast ratio >= 4.5:1 for text on each banner
**Validation:** Unit test for determinism. Visual check in both themes.

#### S2-T3: Create `ClassroomCardGrid` and `ClassroomCardSkeleton` components
**Files:**
- `apps/academics/src/components/classrooms/ClassroomCardGrid.tsx` (new)
- `apps/academics/src/components/classrooms/ClassroomCardSkeleton.tsx` (new)
- `apps/academics/src/components/classrooms/index.ts` (update exports)
**What:** Grid container rendering `ClassroomCard` array. CSS grid: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4`. Loading: 8 `ClassroomCardSkeleton` pulse cards. Empty: illustration + "No classes yet" CTA. "Load more" button when `hasMore`.
**Props:**
```typescript
interface ClassroomCardGridProps {
  sections: SectionResponseDto[]
  isLoading: boolean
  hasMore?: boolean
  isFetchingMore?: boolean
  onLoadMore?: () => void
  onNavigate: (sectionId: string) => void
  onEdit?: (sectionId: string) => void
  onToggleActive?: (section: SectionResponseDto) => void
}
```
**Acceptance:**
- Responsive grid renders cards
- Loading skeleton: 8 placeholders
- Empty state with CTA
- "Load more" when `hasMore`
- Cards get correct `colorIndex` from `getColorForCourse`
**Validation:** Visual check at different sizes. Check all three states.

#### S2-T4: Replace SectionTable with ClassroomCardGrid and add view toggle
**Files:**
- `apps/academics/src/routes/classrooms/index.tsx`
- `apps/academics/src/stores/sections.store.ts` (add `viewMode: 'grid' | 'list'` preference)
**What:** In `MyClassesTab`, add a view toggle (Grid/List icons) near filters. Default to "Grid" (card grid). When "List" selected, render existing `SectionTable`. When "Grid" selected, render `ClassroomCardGrid`. Persist preference in Zustand store. Keep both `SectionTable` and `ClassroomCardGrid` imports — do NOT remove `SectionTable`.

Map handlers: `onNavigate` → navigate to `/classrooms/$sectionId`, `onEdit` → navigate to `/classrooms/$sectionId/edit`.
**Acceptance:**
- Default: card grid renders
- Toggle switches between grid and table
- Preference persists across tab switches
- Both views show same data with same filters
- Navigation works from both views
**Validation:** Toggle views, filter, confirm both work.

#### S2-T5: Redesign stats bar for classroom terminology
**Files:**
- `apps/academics/src/routes/classrooms/index.tsx`
**What:** Update stat card labels to classroom terminology:
- "Total Sections" → "My Classes"
- "Total Enrolled" → "Total Students"
- "Capacity Utilization" → keep
- "Teachers Scheduled" → "Teachers"
**Acceptance:**
- Labels updated, data unchanged
**Validation:** Visual check.

#### S2-T6: Implement `+ Create` dropdown (Google Classroom style)
**Files:**
- `apps/academics/src/components/classrooms/CreateMenu.tsx` (new)
- `apps/academics/src/routes/classrooms/index.tsx` (replace `PageActionsDropdown`)
**What:** Replace `PageActionsDropdown` with Google Classroom-inspired `+ Create` button. Teal rounded pill with `+` icon and "Create" text. Uses HeadlessUI `Menu`:
1. **New Class Section** → navigates to `/classrooms/create` (functional)
2. **Assignment** → disabled, "(Coming Soon)"
3. **Material** → disabled, "(Coming Soon)"
4. **Announcement** → disabled, "(Coming Soon)"

Also migrate `ActionsDropdown` on the detail page to HeadlessUI `Menu` for consistency.
**Acceptance:**
- `+ Create` renders (permission-gated via `schedPerms.create`)
- "New Class Section" navigates to create page
- Disabled items have "(Coming Soon)" suffix
- HeadlessUI keyboard navigation
**Validation:** Visual check. Keyboard navigation test.

#### S2-T7: Update classroom detail header to Google Classroom style
**Files:**
- `apps/academics/src/routes/classrooms/$sectionId.tsx`
**What:** Enhance detail page header:
- **Colored banner** (from `getColorForCourse`) spanning full width
- **Class name** rendered large over banner (white text with text-shadow for contrast)
- **Course name/code** as subtitle
- **Teacher name** below subtitle
- **Enrollment bar** in header area
- **Status badge** + **actions dropdown** at top-right
- Tab navigation below banner (unchanged)
**Acceptance:**
- Banner with course-specific color
- Text legible (color contrast >= 4.5:1)
- All header data displayed
- Actions dropdown functional
- Responsive on mobile
**Validation:** Visual check desktop/mobile. Verify multiple courses show different colors.

#### S2-T8: Add tab content loading skeletons
**Files:**
- `apps/academics/src/components/common/TabContentSkeleton.tsx` (new)
- `apps/academics/src/routes/classrooms/index.tsx`
**What:** When switching to non-lazy tabs (My Classes, Gradebook), the tab mounts and fires queries which may take 500ms+. Add a shared `TabContentSkeleton` that renders during the initial loading state of each tab. Use the existing `isLoading` states from hooks. The skeleton should appear immediately on tab switch, not after a flash of empty content.
**Acceptance:**
- Skeleton appears immediately when switching to a data-heavy tab
- Disappears when data loads
- Matches card grid or table layout shape
**Validation:** Throttle network in dev tools, switch tabs, confirm skeleton shows.

#### S2-T9: End-to-end smoke test for Sprint 2
**What:** Manual walkthrough:
1. `/academics/classrooms` — card grid renders
2. Cards show correct data (name, course, teacher, enrollment, color)
3. Cards have distinct colors per course
4. Click card → detail page with colored banner header
5. `+ Create` dropdown: "New Class Section" works, others show "(Coming Soon)"
6. Grid/List toggle switches views
7. Filters work with card grid
8. Load more works
9. Empty state renders when no matches
10. All tabs (Grades, Attendance, People) still work on detail page
**Acceptance:** All 10 checks pass.
**Validation:** Documented smoke test checklist.

---

## Sprint 3: Lexical Editor Foundation (Shared Package)

**Goal:** Install and configure Lexical as a **shared workspace package** (`@edforge/editor`) reusable across all micro-frontends. Build a composable `EditorShell` component with toolbar, read-only renderer, and serialization utilities. This sprint produces infrastructure — no feature integration yet.

**Demo:** A dev-only route showcasing the editor with full toolbar, read-only toggle, and JSON serialization. Demonstrates production-readiness.

**Architecture Decision:** The editor lives in `packages/editor` (not inside `apps/academics`) because it "will be used quite frequently across the application" (e.g., Student Portal, Communications MFE in the future). It follows the same pattern as `@edforge/ui`, `@edforge/abac`.

### Tickets

#### S3-T1: Create `@edforge/editor` shared package and install Lexical
**Files:**
- `packages/editor/package.json` (new)
- `packages/editor/src/index.ts` (new barrel)
- `packages/editor/tsconfig.json` (new)
- `apps/academics/package.json` (add `@edforge/editor` dependency)
- Module Federation shared config (add lexical as singleton)
**What:** Create a new workspace package at `packages/editor`. Install Lexical packages:
- `lexical`, `@lexical/react`, `@lexical/rich-text`, `@lexical/list`, `@lexical/link`, `@lexical/markdown`, `@lexical/utils`, `@lexical/html`, `@lexical/selection`, `@lexical/history`

Pin to latest stable (^0.21.x). Add `lexical` and `@lexical/react` to the Module Federation shared config in the shell and academics rsbuild configs as singletons (`singleton: true, requiredVersion`). This prevents duplicate Lexical instances across MFE boundaries which would break `useLexicalComposerContext`.

Package exports: `EditorShell`, `ReadOnlyRenderer`, `serializeEditorState`, `deserializeEditorState`, `editorStateToPlainText`, `isEditorStateEmpty`.
**Acceptance:**
- Package installs without errors
- `pnpm build` passes (all workspaces)
- No duplicate React or Lexical instances in MF runtime
- `@edforge/editor` importable from academics app
**Validation:** `pnpm install && pnpm build`. Check MF shared config output.

#### S3-T2: Create Lexical theme configuration
**Files:**
- `packages/editor/src/theme.ts` (new)
**What:** Lexical theme object mapping CSS class names to EdForge Tailwind classes:
- `paragraph`, `heading` (h1-h4), `text` (bold, italic, underline, strikethrough, code)
- `list` (ol, ul, nested), `listItem`, `listItemChecked`
- `link`, `quote`, `code` (block)
All classes use EdForge design tokens. Include both light and dark mode compatible classes.
**Acceptance:**
- Theme exports cleanly
- All node types have class mappings
- Uses EdForge tokens
**Validation:** TypeScript compiles. Visual check in S3-T5.

#### S3-T3: Create `ToolbarPlugin` component
**Files:**
- `packages/editor/src/plugins/ToolbarPlugin.tsx` (new)
**What:** Toolbar with buttons:
- Bold (Cmd+B), Italic (Cmd+I), Underline (Cmd+U)
- Heading (H1, H2) toggle
- Bullet List / Numbered List toggle
- Link insert (URL input popover with focus trap)
- Block Quote
- Undo / Redo

Uses `useLexicalComposerContext`. Listens to selection changes for active state. All buttons have `aria-label` and toggle buttons have `aria-pressed`. EdForge styled (surface-secondary bg, icon buttons with hover).
**Acceptance:**
- All buttons render and apply formatting
- Active state shows on formatted text
- Keyboard shortcuts work
- Link URL popover with focus trap
- ARIA labels on all buttons
**Validation:** Manual test of each format. Screen reader test of toolbar.

#### S3-T4: Create serialization utilities
**Files:**
- `packages/editor/src/utils/serialization.ts` (new)
**What:** Utility functions:
- `serializeEditorState(editorState: EditorState): string`
- `deserializeEditorState(json: string): SerializedEditorState`
- `editorStateToPlainText(editorState: EditorState): string`
- `editorStateToHtml(editor: LexicalEditor): string`
- `isEditorStateEmpty(editorState: EditorState): boolean`
**Acceptance:**
- Round-trip: serialize → deserialize → content matches
- Plain text strips formatting
- HTML export produces valid HTML
- Empty check works
**Validation:** Unit tests.

#### S3-T5: Create `EditorShell` composable component
**Files:**
- `packages/editor/src/EditorShell.tsx` (new)
**What:** Main composable editor wrapping `LexicalComposer`:
```typescript
interface EditorShellProps {
  initialState?: string
  onChange?: (state: string) => void
  readOnly?: boolean
  placeholder?: string
  minHeight?: string
  maxHeight?: string
  autoFocus?: boolean
  className?: string
  ariaLabel?: string  // for accessibility
}
```
Composes: `RichTextPlugin`, `HistoryPlugin`, `ListPlugin`, `LinkPlugin`, `MarkdownShortcutPlugin`, `OnChangePlugin`, `ToolbarPlugin` (hidden when readOnly). Content area has `role="textbox"`, `aria-multiline="true"`, and the provided `ariaLabel`.
**Acceptance:**
- Editor renders with toolbar + content
- `onChange` fires with serialized state
- `readOnly` hides toolbar, disables editing
- `initialState` hydrates content
- Placeholder shows when empty
- ARIA attributes present
**Validation:** Manual test. Accessibility check.

#### S3-T6: Create `ReadOnlyRenderer` component
**Files:**
- `packages/editor/src/ReadOnlyRenderer.tsx` (new)
**What:** Lightweight read-only renderer using `EditorShell` with `readOnly={true}`. Accepts `content: string` (serialized JSON). Handles empty/null/invalid gracefully.
**Acceptance:**
- Renders formatted text from JSON
- No toolbar or editable UI
- Graceful handling of bad input
**Validation:** Render sample content, verify. Pass null, no crash.

#### S3-T7: Create dev-only editor demo route
**Files:**
- `apps/academics/src/routes/classrooms/editor-demo.tsx` (new)
- `apps/academics/src/router.tsx` (add route, dev-only guard)
**What:** Demo page at `/classrooms/editor-demo` (dev only):
- Full editor with toolbar
- JSON output panel (real-time)
- Plain text output panel
- Read-only toggle
- Clear and load sample buttons
**Acceptance:**
- Renders in dev mode only
- All editor features work
- JSON updates live
**Validation:** Manual test of all features.

#### S3-T8: Unit tests for editor utilities
**Files:**
- `packages/editor/src/utils/__tests__/serialization.test.ts` (new)
**What:** Unit tests:
- `serializeEditorState` produces valid JSON
- `deserializeEditorState` parses correctly
- `editorStateToPlainText` strips formatting
- `isEditorStateEmpty` true/false
- Round-trip test
- Edge cases: empty, malformed JSON
**Acceptance:**
- All tests pass
**Validation:** `pnpm test`.

---

## Sprint 4: Stream Tab — Posts, Announcements & Comments

**Goal:** Implement the Stream tab with a Google Classroom-style chronological feed. Teachers create posts using the Lexical editor. Posts display with rich text, author info, timestamps, and expandable comment threads. All data is mock via hooks (no backend). Change default detail tab to `'stream'`.

**Demo:** Navigate to classroom detail → Stream tab (now default). See post composer, mock posts with rich text, expandable comments.

### Tickets

#### S4-T1: Define Stream types and create data-provider hooks
**Files:**
- `apps/academics/src/components/classrooms/stream/types.ts` (new)
- `apps/academics/src/hooks/useStreamPosts.ts` (new)
**What:** Define TypeScript interfaces:
```typescript
interface StreamPost {
  postId: string
  sectionId: string
  authorId: string
  authorName: string
  authorRole: 'teacher' | 'student'
  type: 'announcement' | 'post' | 'material'
  content: string  // serialized Lexical JSON
  plainText: string
  attachments?: StreamAttachment[]
  commentCount: number
  createdAt: string
  updatedAt?: string
  isPinned?: boolean
}
interface StreamComment { commentId: string; postId: string; authorId: string; authorName: string; authorRole: 'teacher' | 'student'; content: string; createdAt: string }
interface StreamAttachment { attachmentId: string; fileName: string; fileType: string; fileSize: number; url?: string }
```

Create hook `useStreamPosts(sectionId: string)` that returns `{ posts, isLoading, createPost, addComment }`. Internally uses local state initialized with mock data. This hook has the **same interface** that a future React Query hook would have — when backend is ready, swap the implementation, zero component changes.

Also create internal `mock-data.ts` with `generateMockStreamPosts()` and `generateMockComments()`.
**Acceptance:**
- Types compile
- Hook returns mock data
- `createPost` adds to local state
- `addComment` adds to post's comments
- Hook interface matches future API pattern
**Validation:** TypeScript build. Import hook, verify data structure.

#### S4-T2: Create `PostComposer` component
**Files:**
- `apps/academics/src/components/classrooms/stream/PostComposer.tsx` (new)
**What:** Google Classroom-style post creation:
- **Collapsed:** Clickable bar with avatar + "Share something with your class..." (has `role="button"`, `aria-expanded="false"`)
- **Expanded (on click):** Lexical `EditorShell`, post type chips (Announcement/Post/Material), "Attach" (disabled), "Post" (teal) and "Cancel" buttons
- On "Post": calls `onSubmit` callback with content, clears editor
- On "Cancel" with content: confirmation dialog, then collapse
- `aria-expanded="true"` when expanded
**Acceptance:**
- Collapsed/expanded states work
- Editor produces rich text
- Post button fires callback
- Cancel with dirty content shows confirmation
- Proper ARIA attributes
**Validation:** Visual check. Type post, submit. Cancel with content, confirm dialog.

#### S4-T3: Create `StreamPostCard` component
**Files:**
- `apps/academics/src/components/classrooms/stream/StreamPostCard.tsx` (new)
**What:** Renders a post:
- **Header:** Avatar (initials), author name, role badge, relative timestamp
- **Type indicator:** Icon+label (announcement/material/post)
- **Content:** `ReadOnlyRenderer`. Truncated to ~200px with "Show more" toggle for long posts
- **Attachments:** Pills if present
- **Footer:** Comment count (clickable to expand), three-dot menu (Edit/Delete stubbed)
- **Pinned:** Pin icon at top-right
- `<article>` element with `aria-label`
**Acceptance:**
- All fields render
- ReadOnlyRenderer displays rich text
- Long content truncated with "Show more"
- Comment count clickable
**Validation:** Render with mock data, verify.

#### S4-T4: Create `CommentThread` component
**Files:**
- `apps/academics/src/components/classrooms/stream/CommentThread.tsx` (new)
**What:** Comments list + input:
- Comment items: avatar, name, timestamp, text (as `role="list"` with `role="listitem"`)
- "Add a comment..." plain text input + "Post" button
- Expand/collapse with framer-motion, `aria-expanded` on toggle
**Acceptance:**
- Comments render
- Input + Post adds comment to local list
- Animated expand/collapse
- Proper ARIA
**Validation:** Expand thread, add comment.

#### S4-T5: Create `StreamFeed` container and `relative-time` utility
**Files:**
- `apps/academics/src/components/classrooms/stream/StreamFeed.tsx` (new)
- `apps/academics/src/components/classrooms/stream/index.ts` (new barrel)
- `apps/academics/src/lib/relative-time.ts` (new)
**What:** Main container for Stream tab:
- Uses `useStreamPosts(sectionId)` hook for data
- Renders `PostComposer` (if `schedPerms.create`)
- Renders `StreamPostCard[]` sorted by date (pinned first)
- Each card has expandable `CommentThread`
- Empty state if no posts

`formatRelativeTime(dateString)` utility: "Just now", "X minutes ago", "X hours ago", "Yesterday", "X days ago", full date for older.

`StreamFeed` accepts `onSwitchTab: (tab: ClassroomDetailTab) => void` for Quick Actions.
**Acceptance:**
- Feed renders with mock posts from hook
- New posts appear at top
- Comment threads expand/collapse
- Quick Actions switch tabs
- Switching tabs via Quick Actions does NOT discard in-progress post composition
**Validation:** Full stream flow walkthrough.

#### S4-T6: Replace StreamPlaceholder with StreamFeed in detail page, change default tab
**Files:**
- `apps/academics/src/routes/classrooms/$sectionId.tsx`
- `apps/academics/src/router.tsx` (update `validateSearch` default)
**What:** Replace `StreamPlaceholder` with `StreamFeed`. Pass `sectionId` and `onSwitchTab`. Remove `StreamPlaceholder` definition. Change default tab from `'people'` to `'stream'` in `validateSearch`.
**Acceptance:**
- Stream tab renders full feed
- Default tab is now `stream`
- Other tabs unaffected
- `onSwitchTab` wired correctly
**Validation:** Navigate to detail page — Stream tab shown by default with mock posts.

#### S4-T7: Add "Quick Actions" to Stream tab
**Files:**
- `apps/academics/src/components/classrooms/stream/StreamFeed.tsx`
**What:** Below composer, above feed: horizontal row of shortcut buttons:
- **Take Attendance** → `onSwitchTab('attendance')`
- **Open Gradebook** → `onSwitchTab('grades')`
- **View Roster** → `onSwitchTab('people')`
Styled as subtle secondary icon+text buttons.
**Acceptance:**
- Buttons render
- Each switches to correct tab
- Subtle styling, doesn't compete with composer
**Validation:** Click each, confirm tab switch.

#### S4-T8: Unit tests for Stream
**Files:**
- `apps/academics/src/components/classrooms/stream/__tests__/StreamFeed.test.tsx` (new)
- `apps/academics/src/components/classrooms/stream/__tests__/PostComposer.test.tsx` (new)
- `apps/academics/src/lib/__tests__/relative-time.test.ts` (new)
**What:**
- `StreamFeed`: renders mock posts, renders empty state, new post appears at top
- `PostComposer`: collapsed by default, expands on click, fires onSubmit
- `formatRelativeTime`: correct output for various time differences
**Acceptance:** All tests pass.
**Validation:** `pnpm test`.

#### S4-T9: End-to-end smoke test for Sprint 4
**What:**
1. Navigate to classroom detail → defaults to Stream tab
2. Post composer visible (collapsed)
3. Click composer → expands with Lexical editor
4. Type rich text (bold, list) and Post → appears at top
5. Mock posts show with author, timestamp, rich content
6. Click comment count → thread expands with mock comments
7. Add comment → appears in thread
8. Long post truncated with "Show more"
9. Quick Actions: Take Attendance → Attendance tab
10. Switch back to Stream → feed persists (posts not lost)
**Acceptance:** All 10 checks pass.

---

## Sprint 5: Classwork Tab — Assignments, Materials & Topics

**Goal:** Implement the Classwork tab with Google Classroom-style assignments, materials, and topics. Mock data via hooks for non-implemented features. Existing `AssignmentEditor` integrated for real assignment creation.

**Demo:** Classwork tab shows topics with grouped items. `+ Create` dropdown creates real assignments via existing API. Stubbed items show toasts.

### Tickets

#### S5-T1: Define Classwork types and create data-provider hooks
**Files:**
- `apps/academics/src/components/classrooms/classwork/types.ts` (new)
- `apps/academics/src/hooks/useClassworkItems.ts` (new)
**What:** Types:
```typescript
type ClassworkItemType = 'assignment' | 'quiz' | 'material' | 'question'
interface ClassworkItem { itemId: string; sectionId: string; type: ClassworkItemType; title: string; description?: string; topicId?: string; topicName?: string; dueDate?: string; possiblePoints?: number; status: 'draft' | 'published' | 'scheduled'; createdAt: string; updatedAt?: string; attachments?: ClassworkAttachment[] }
interface ClassworkTopic { topicId: string; sectionId: string; name: string; sortOrder: number }
interface ClassworkAttachment { attachmentId: string; fileName: string; fileType: string; url?: string }
```

Hook `useClassworkItems(sectionId: string)` returns `{ items, topics, isLoading, addTopic }`. Mock data internally. Same interface as future API hook.
**Acceptance:**
- Types compile
- Hook returns structured mock data
- `addTopic` adds to local state
**Validation:** TypeScript build. Import hook, verify.

#### S5-T2: Create `ClassworkItemCard` component
**Files:**
- `apps/academics/src/components/classrooms/classwork/ClassworkItemCard.tsx` (new)
**What:** Card/row for a classwork item:
- **Left:** Type-specific icon in colored circle (assignment: clipboard, quiz: help-circle, material: file, question: message-circle)
- **Title:** Bold
- **Meta:** Due date, points, status badge (Draft/Published)
- **Right:** Three-dot menu (View/Edit stubbed)
- Click: toast "Coming soon"
**Acceptance:**
- Correct icon per type
- All metadata displays
- Draft badge visible
**Validation:** Render each type, verify.

#### S5-T3: Create `TopicSection` component
**Files:**
- `apps/academics/src/components/classrooms/classwork/TopicSection.tsx` (new)
**What:** Collapsible section grouping items by topic:
- **Header:** Topic name, collapse/expand chevron with `aria-expanded`, item count badge
- **Body:** `ClassworkItemCard[]`
- **Uncategorized:** "Other" section at bottom
- Framer-motion animation
**Acceptance:**
- Collapsible with animation
- Items grouped correctly
- "Other" section for ungrouped
- ARIA attributes
**Validation:** Visual check.

#### S5-T4: Create `ClassworkCreateMenu` component
**Files:**
- `apps/academics/src/components/classrooms/classwork/ClassworkCreateMenu.tsx` (new)
**What:** `+ Create` button with HeadlessUI `Menu` dropdown:
1. **Assignment** → opens existing `AssignmentEditor` (functional, real API)
2. **Quiz Assignment** → toast "Coming soon"
3. **Question** → toast "Coming soon"
4. **Material** → toast "Coming soon"
5. **Topic** → inline name input to add topic to local state
**Acceptance:**
- Assignment opens real AssignmentEditor
- Stubs show toasts
- Topic adds inline
**Validation:** Click each item.

#### S5-T5: Create `ClassworkFeed` container
**Files:**
- `apps/academics/src/components/classrooms/classwork/ClassworkFeed.tsx` (new)
- `apps/academics/src/components/classrooms/classwork/index.ts` (new barrel)
**What:** Main container:
- Uses `useClassworkItems(sectionId)` hook
- Renders `ClassworkCreateMenu`
- Renders `TopicSection[]` with grouped items
- Ungrouped items at bottom
- Empty state
- Integrates `AssignmentEditor` when creating assignment (passes sectionId, courseId, etc.)
**Acceptance:**
- Feed renders with topics and items
- AssignmentEditor saves to real API
- Empty state works
**Validation:** Visual walkthrough.

#### S5-T6: Replace ClassworkPlaceholder with ClassworkFeed
**Files:**
- `apps/academics/src/routes/classrooms/$sectionId.tsx`
**What:** Replace `ClassworkPlaceholder` with `ClassworkFeed`. Pass `sectionId`, `section`, school/year context. Remove `ClassworkPlaceholder` definition.
**Acceptance:**
- Classwork tab renders full feed
- AssignmentEditor works with correct context
- Other tabs unaffected
**Validation:** Navigate to Classwork tab, see mock items. Create assignment.

#### S5-T7: End-to-end smoke test for Sprint 5
**What:**
1. Classwork tab → topics with grouped items
2. Collapse/expand topic
3. `+ Create` → Assignment opens AssignmentEditor with correct section
4. Create assignment → saves (real API)
5. Stubbed items → toast
6. Topic creation → new topic inline
7. Stream tab: Quick Actions work
8. Attendance tab: section-scoped (from S1-T7)
9. Grades tab: gradebook loads, editing works
10. All tabs stable, no regressions
**Acceptance:** All 10 checks pass.

---

## Sprint 6: Polish, Accessibility, Performance & Cleanup

**Goal:** Production-grade polish. Accessibility compliance (WCAG 2.1 AA), performance optimization (lazy loading, bundle size), dark mode verification, mobile responsiveness, and cleanup of temporary artifacts.

**Demo:** Full walkthrough with keyboard-only navigation, screen reader, dark mode, mobile widths, and performance profiling.

### Tickets

#### S6-T1: Accessibility audit — ClassroomCardGrid
**Files:**
- `apps/academics/src/components/classrooms/ClassroomCard.tsx`
- `apps/academics/src/components/classrooms/ClassroomCardGrid.tsx`
**What:** WCAG 2.1 AA:
- Cards: `<article>` with `aria-label`
- Focus visible outlines
- Keyboard: Tab between cards, Enter to open
- Color contrast >= 4.5:1 on banners
**Validation:** aXe audit. Keyboard-only walkthrough.

#### S6-T2: Accessibility audit — Lexical editor
**Files:**
- `packages/editor/src/EditorShell.tsx`
- `packages/editor/src/plugins/ToolbarPlugin.tsx`
**What:** WCAG 2.1 AA:
- Toolbar: `aria-label`, `aria-pressed` on toggles
- Content: `role="textbox"`, `aria-multiline="true"`
- Link popover: focus trap
- `aria-live` region for format change announcements
**Validation:** VoiceOver test. aXe audit.

#### S6-T3: Accessibility audit — Stream and Classwork
**Files:** Stream and Classwork components
**What:**
- PostComposer: `role="button"`, `aria-expanded`
- Posts: `<article>` with `aria-label`
- Comments: `aria-expanded`, `role="list"`
- Topics: `aria-expanded` on collapse
- Focus management: post → focus returns to feed
**Validation:** Keyboard-only walkthrough. aXe audit.

#### S6-T4: Mobile responsiveness audit
**What:** Test all new components at 320px, 768px, 1024px, 1440px:
- Card grid responsive columns
- Editor toolbar overflow (consider collapsed toolbar on mobile)
- PostComposer expand/collapse touch targets (>= 44x44px per WCAG)
- Banner header collapse on mobile
- Tab navigation horizontal scroll on small screens
**Acceptance:** No layout breaks at any viewport. Touch targets >= 44x44px.
**Validation:** Chrome DevTools device emulation. Manual check.

#### S6-T5: Dark mode visual audit
**What:** Verify all Sprint 2-5 components in dark theme:
- Card banner colors in dark mode
- Editor toolbar and content area
- Stream posts and comments
- Classwork topic sections
- Colored banner on detail page
**Acceptance:** All components render correctly in dark mode. No hard-to-read text.
**Validation:** Toggle dark mode, walk through all pages.

#### S6-T6: Lazy load Stream and Classwork tabs
**Files:**
- `apps/academics/src/routes/classrooms/$sectionId.tsx`
**What:** Lazy load Stream and Classwork tabs via `React.lazy` with `Suspense` skeleton fallback. Initial detail page load should NOT include Lexical bundle.
**Acceptance:**
- Stream/Classwork lazy loaded
- Lexical bundle only loads when those tabs are clicked
- Suspense skeleton during load
**Validation:** Network tab — no Lexical chunks on initial load.

#### S6-T7: Bundle size check and tree-shaking verification
**What:** Run `pnpm build`, document bundle sizes. Lexical expected ~40-60KB gzipped. Verify tree-shaking. Compare with pre-Classrooms baseline.
**Acceptance:**
- Bundle sizes documented
- No unexpected bloat
**Validation:** Build output analysis.

#### S6-T8: Remove dev-only editor demo route
**Files:**
- `apps/academics/src/routes/classrooms/editor-demo.tsx` (delete)
- `apps/academics/src/router.tsx` (remove route)
**Acceptance:** Route gone. Build passes.

#### S6-T9: Remove MigrationNotice and cleanup
**Files:**
- `apps/academics/src/components/classrooms/MigrationNotice.tsx` (delete)
- `apps/academics/src/routes/classrooms/index.tsx` (remove import/render)
- Various: remove all `as any` casts in classrooms routes, clean unused imports, audit `components/scheduling/index.ts` exports
**What:** Remove migration banner. Remove all `as any` casts — use proper TypeScript types for update payloads and search params. Audit scheduling barrel exports. Audit MF `exposes` list — if `AttendanceModule` and `GradebookModule` are no longer consumed standalone, remove from `exposes`.
**Acceptance:**
- No migration banner
- No `as any` casts in classrooms routes
- Clean barrel exports
- MF exposes list current
- Build passes
**Validation:** Build. Grep for `as any`.

#### S6-T10: Final regression test
**What:**
1. **Classrooms List:** Card grid, filters, grid/list toggle, create
2. **Classroom Detail:** Colored banner, all 5 tabs, tab URL sync
3. **People tab:** Roster loads, add/remove students
4. **Grades tab:** Gradebook, inline editing, bulk record, finalize, report card
5. **Attendance tab:** Section-scoped, date selector, status toggles, summary
6. **Stream tab:** Composer, posts, comments, rich text
7. **Classwork tab:** Topics, items, create assignment, stubs toast
8. **Navigation:** Sidebar links, back button, breadcrumbs
9. **Accessibility:** Keyboard-only walkthrough
10. **Performance:** Page load < 3s, no jank, lazy loading works
11. **Dark mode:** All new components
12. **Mobile:** 320px → 1440px
13. **Legacy routes:** All redirect correctly
14. **Students page:** Unchanged at `/academics/students`
15. **Curriculum page:** Unchanged at `/academics/curriculum`
**Acceptance:** All 15 checks pass.
**Validation:** Documented regression checklist.

---

## Architecture Reference

### Component Tree (Final State)

```
/academics/classrooms (ClassroomsModule)
├── PageHeader
│   ├── ClassroomsIcon + Title
│   └── CreateMenu (+ Create dropdown, HeadlessUI)
├── TabNavigation (with validateSearch type safety)
│   ├── My Classes
│   ├── Overview
│   ├── Gradebook
│   ├── Grading Policies
│   └── Attendance Board
└── TabContent (with TabContentSkeleton during loading)
    ├── MyClassesTab
    │   ├── StatCards (classroom terminology)
    │   ├── ViewToggle (Grid / List)
    │   ├── SectionFilters
    │   └── ClassroomCardGrid / SectionTable
    ├── OverviewTab → GradeOverview
    ├── GradebookTab → section selector + GradebookGrid + modals
    ├── GradingPoliciesTab → GradingPolicyList
    └── AttendanceBoardTab → AttendanceModule (lazy)

/academics/classrooms/$sectionId (ClassroomDetailPage)
├── ColoredBannerHeader (getColorForCourse)
│   ├── SectionName, CourseName, Teacher
│   ├── EnrollmentBar
│   ├── StatusBadge
│   └── ActionsDropdown (HeadlessUI, Edit → /edit page)
├── TabNavigation (validateSearch, default: 'stream')
│   ├── Stream
│   ├── Classwork
│   ├── People
│   ├── Grades
│   └── Attendance
└── TabContent (TabErrorBoundary from common/)
    ├── StreamTab (lazy, React.Suspense)
    │   ├── PostComposer (@edforge/editor EditorShell)
    │   ├── QuickActions (onSwitchTab)
    │   └── StreamPostCard[] (ReadOnlyRenderer + CommentThread)
    ├── ClassworkTab (lazy, React.Suspense)
    │   ├── ClassworkCreateMenu (HeadlessUI)
    │   └── TopicSection[] → ClassworkItemCard[]
    ├── PeopleTab → SectionRoster
    ├── GradesTab → SectionGradesTab (GradebookGrid + modals)
    └── AttendanceTab → SectionAttendanceWrapper (section-scoped)

/academics/classrooms/create (SectionCreatePage)
└── FormProvider + SectionForm (full page)

/academics/classrooms/$sectionId/edit (SectionEditPage)
└── FormProvider + SectionForm (full page, pre-populated)
```

### New Files Summary

| Sprint | New Files | Modified Files | Deleted Files |
|--------|-----------|---------------|---------------|
| S1 | `routes/classrooms/create.tsx`, `routes/classrooms/$sectionId.edit.tsx`, `components/common/TabErrorBoundary.tsx`, `components/attendance/SectionAttendanceWrapper.tsx` | `router.tsx`, `routes/classrooms/index.tsx`, `routes/classrooms/$sectionId.tsx`, `routes/scheduling/*`, `routes/attendance/*`, `routes/grades/*`, `sidebar-modules.ts` | `components/scheduling/SectionDrawer.tsx` |
| S2 | `components/classrooms/ClassroomCard.tsx`, `ClassroomCardGrid.tsx`, `ClassroomCardSkeleton.tsx`, `CreateMenu.tsx`, `lib/classroom-colors.ts`, `components/common/TabContentSkeleton.tsx` | `routes/classrooms/index.tsx`, `routes/classrooms/$sectionId.tsx`, `stores/sections.store.ts` | — |
| S3 | `packages/editor/*` (theme, EditorShell, ReadOnlyRenderer, ToolbarPlugin, serialization utils), `routes/classrooms/editor-demo.tsx` | `package.json`, `router.tsx`, `rsbuild.config.ts` (MF shared) | — |
| S4 | `components/classrooms/stream/*` (types, mock, PostComposer, StreamPostCard, CommentThread, StreamFeed), `hooks/useStreamPosts.ts`, `lib/relative-time.ts` | `routes/classrooms/$sectionId.tsx`, `router.tsx` (default tab) | — |
| S5 | `components/classrooms/classwork/*` (types, mock, ClassworkItemCard, TopicSection, ClassworkCreateMenu, ClassworkFeed), `hooks/useClassworkItems.ts` | `routes/classrooms/$sectionId.tsx` | — |
| S6 | — | Various accessibility/perf fixes | `MigrationNotice.tsx`, `editor-demo.tsx` |

### Package Organization

```
packages/
└── editor/                        # @edforge/editor (Sprint 3)
    ├── src/
    │   ├── theme.ts
    │   ├── EditorShell.tsx
    │   ├── ReadOnlyRenderer.tsx
    │   ├── plugins/
    │   │   └── ToolbarPlugin.tsx
    │   ├── utils/
    │   │   └── serialization.ts
    │   └── index.ts
    ├── package.json
    └── tsconfig.json

apps/academics/src/
├── components/
│   ├── classrooms/
│   │   ├── ClassroomCard.tsx          # S2
│   │   ├── ClassroomCardGrid.tsx      # S2
│   │   ├── ClassroomCardSkeleton.tsx  # S2
│   │   ├── CreateMenu.tsx             # S2
│   │   ├── stream/
│   │   │   ├── types.ts               # S4
│   │   │   ├── mock-data.ts           # S4
│   │   │   ├── PostComposer.tsx       # S4
│   │   │   ├── StreamPostCard.tsx     # S4
│   │   │   ├── CommentThread.tsx      # S4
│   │   │   ├── StreamFeed.tsx         # S4
│   │   │   └── index.ts
│   │   ├── classwork/
│   │   │   ├── types.ts               # S5
│   │   │   ├── mock-data.ts           # S5
│   │   │   ├── ClassworkItemCard.tsx   # S5
│   │   │   ├── TopicSection.tsx        # S5
│   │   │   ├── ClassworkCreateMenu.tsx # S5
│   │   │   ├── ClassworkFeed.tsx       # S5
│   │   │   └── index.ts
│   │   └── index.ts
│   ├── common/
│   │   ├── TabErrorBoundary.tsx        # S1
│   │   ├── TabContentSkeleton.tsx      # S2
│   │   └── ...existing
│   ├── attendance/
│   │   ├── SectionAttendanceWrapper.tsx # S1
│   │   └── ...existing
│   └── scheduling/                     # SectionDrawer deleted S1
│       ├── SectionTable.tsx
│       ├── SectionFilters.tsx
│       ├── SectionForm.tsx
│       ├── SectionRoster.tsx
│       └── index.ts
├── hooks/
│   ├── useStreamPosts.ts              # S4
│   ├── useClassworkItems.ts           # S5
│   └── ...existing
└── lib/
    ├── classroom-colors.ts            # S2
    ├── relative-time.ts               # S4
    └── ...existing
```

### Dependencies Added

**Sprint 3 — `packages/editor/package.json`:**
```json
{
  "lexical": "^0.21.0",
  "@lexical/react": "^0.21.0",
  "@lexical/rich-text": "^0.21.0",
  "@lexical/list": "^0.21.0",
  "@lexical/link": "^0.21.0",
  "@lexical/markdown": "^0.21.0",
  "@lexical/utils": "^0.21.0",
  "@lexical/html": "^0.21.0",
  "@lexical/selection": "^0.21.0",
  "@lexical/history": "^0.21.0"
}
```

**Module Federation shared config addition:**
```typescript
shared: {
  // ...existing
  'lexical': { singleton: true, requiredVersion: '^0.21.0' },
  '@lexical/react': { singleton: true, requiredVersion: '^0.21.0' },
}
```

### ABAC Permissions Model

| Resource | Used By | Notes |
|----------|---------|-------|
| `classes` | Sidebar visibility for "Classrooms" | New permission resource |
| `scheduling` | Section CRUD, roster management, Stream post creation (teacher gate) | Existing, unchanged |
| `grades` | Gradebook, BulkGradeModal, AssignmentEditor, FinalizationWizard | Existing, unchanged |
| `attendance` | Attendance grid, bulk attendance | Existing, unchanged |
| `courses` | Sidebar visibility for "Curriculum" | Existing, unchanged |
| `students` | Sidebar visibility for "Students" | Existing, unchanged |

---

## Risk Mitigation

1. **Regression risk:** Each sprint includes a smoke test ticket. Existing API hooks, services, and shared types are **never modified** — only presentation layer changes.
2. **Route conflict (`$sectionId` swallowing static routes):** Resolved in S1-T1 by restructuring to nested route tree with static routes registered before dynamic.
3. **SectionForm drawer coupling:** S1-T4/T5 explicitly handle `FormProvider` wrapping, dirty-state confirmation, and all patterns currently in `SectionDrawer`.
4. **Bundle size:** Lexical isolated to shared package and lazy-loaded in S6-T6. Expected ~40-60KB gzipped.
5. **Mock data coupling:** Hook-based data provider pattern (`useStreamPosts`, `useClassworkItems`) — same interface as future React Query hooks. Zero component changes on backend integration.
6. **Module Federation Lexical singleton:** S3-T1 adds Lexical to MF shared config. Prevents broken context across MFE boundaries.
7. **Section-scoped attendance bug:** Fixed in S1-T7, not deferred to Sprint 5. Validated in S1-T10 smoke test.
8. **Legacy route breakage:** Redirects via `beforeLoad` in S1-T1 before any UI changes.

## Review Feedback Incorporated

This plan incorporates feedback from architectural review. Key changes from initial draft:

| # | Issue | Resolution |
|---|-------|-----------|
| P0-1 | Redundant redirect implementations (S1-T1 vs S1-T7) | Merged: S1-T1 handles all redirects via `beforeLoad` |
| P0-2 | Route conflict: `$sectionId` swallows `/create` | S1-T1: nested route tree with static-before-dynamic |
| P0-3 | SectionForm coupled to drawer context | S1-T4/T5: explicit `FormProvider` + dirty-state guidance |
| P0-4 | Section-scoped attendance misplaced in Sprint 5 | Moved to S1-T7 |
| P1-5 | Missing `validateSearch` for tab type safety | S1-T1: added to route definitions |
| P1-6 | Editor should be shared package | S3: `@edforge/editor` in `packages/editor` |
| P1-7 | Lexical MF singleton risk | S3-T1: added to MF shared config |
| P1-8 | Duplicated TabErrorBoundary | S1-T8: extracted to common with retry button |
| P1-9 | Mock data direct import fragility | S4/S5: hook-based data provider pattern |
| P1-10 | SectionTable removal conflict with view toggle | S2-T4: merged — keep both imports |
| P1-11 | StreamFeed tab-switch coupling | S4-T5: `onSwitchTab` prop + unsaved content protection |
| P1-12 | Default detail tab should be `stream` | S4-T6: changed after Stream implemented |
| P2-13 | No mobile responsiveness ticket | S6-T4 added |
| P2-14 | No dark mode testing | S6-T5 added |
| P2-15 | Tab content loading skeletons | S2-T8 added |
| P2-16 | Hand-rolled dropdowns vs HeadlessUI | S2-T6: migrate to HeadlessUI |
| P2-17 | Tab history behavior undocumented | Design Decisions section added |
| P2-18 | `as any` casts | S6-T9: cleanup ticket |
