# EdForge Landing Page — Production-Ready Sprint Plan

> Based on staff-engineer/UX architecture review (Gemini). Every task is an atomic, committable unit of work with explicit validation. Every sprint yields a demoable, buildable artifact that composes on previous work.

**Stack:** Rsbuild + React 19 + Tailwind CSS v4 + TanStack Router + Framer Motion + Recharts + Vitest
**Deploy:** Vercel
**Monorepo path:** `edforge-saas-frontend/apps/shell/src/components/landing/`

---

## Sprint 1: Accessibility & WCAG AA Compliance

**Goal:** Pass WCAG AA (4.5:1 text, 3:1 UI elements) across the entire landing page. Every commit is independently verifiable via axe-core or Lighthouse accessibility audit.

**Demo:** Run `pnpm vitest` showing all a11y tests green. Run Lighthouse on local dev showing 0 contrast violations and 0 heading-hierarchy warnings.

### Tickets

#### S1-01: Add axe-core accessibility test harness for landing page
**File:** `apps/shell/src/components/landing/__tests__/a11y.test.tsx` (new)
**Work:**
- Install `axe-core` and `vitest-axe` (or `@axe-core/react`) as devDependencies
- Create test file that renders `LandingPage` inside a TanStack `RouterProvider` with a memory history and runs `axe()` against the container
- Assert zero `violations` with severity `critical` or `serious`
- This test will initially FAIL — that's expected and validates the harness works
**Validation:** `pnpm vitest a11y` runs and produces a list of current violations (baseline)

#### S1-02: Fix hero subtitle contrast — replace hardcoded `#8aafbf` with CSS variable
**Files:** `landing.css`, `HeroSection.tsx:81`
**Work:**
- Current subtitle `<p>` at `HeroSection.tsx:81` uses hardcoded Tailwind class `text-[#8aafbf]`. This does NOT inherit from `--text-secondary`. The class must be replaced.
- Replace `text-[#8aafbf]` on the `<p>` with `style={{ color: 'rgb(var(--text-secondary))' }}`
- Bump `--text-secondary` in `landing.css` from `138 175 191` (`#8aafbf`) to `160 195 210` (`#a0c3d2`) = ~5.5:1 contrast on `#0a1a24` (passes AA)
- Verify scrollytelling section text panels (which already use `--text-secondary` via inline styles) also benefit
**Validation:** WebAIM contrast check confirms >= 4.5:1. No hardcoded `#8aafbf` remains in `HeroSection.tsx`.

#### S1-03: Fix hero pillar detail text contrast — replace hardcoded `#4d7f8f` with CSS variable
**Files:** `landing.css`, `HeroSection.tsx:108`
**Work:**
- Current: `text-[#4d7f8f]` on `#0a1a24` = ~2.8:1 (fails AA)
- Bump `--text-tertiary` in `landing.css` from `77 127 143` to `100 155 175` (`#649baf`) = ~4.6:1
- Replace hardcoded `text-[#4d7f8f]` at `HeroSection.tsx:108` with `style={{ color: 'rgb(var(--text-tertiary))' }}`
- Verify footer copyright text (`Footer.tsx:116`) also uses `--text-tertiary` and now passes
**Validation:** WebAIM contrast check passes. Zero hardcoded `#4d7f8f` remains in `HeroSection.tsx`.

#### S1-04: Fix hero pillar title contrast — bump `text-white/60` to `text-white/70`
**File:** `HeroSection.tsx:105`
**Work:**
- Current: `text-white/60` = `rgba(255,255,255,0.6)` on `#0a1a24` = ~5.8:1 (borderline)
- Bump to `text-white/70` = `rgba(255,255,255,0.7)` = ~7.1:1 (comfortably AA)
**Validation:** Visual inspection + contrast check >= 7.0:1.

#### S1-05: Fix hero badge pill text contrast
**File:** `HeroSection.tsx:66`
**Work:**
- Badge uses `text-[#5ec4b6]/80` = roughly `rgba(94,196,182,0.8)` over effective bg `#0a1a24` = ~3.9:1 (fails AA)
- Replace with `text-[#7dd8c4]` (full opacity) = ~6.3:1
**Validation:** Contrast check on badge text >= 4.5:1.

#### S1-06: Fix scrollytelling badge pill text contrast (inline styles)
**File:** `ScrollytellingSection.tsx:155-156, 205-206`
**Work:**
- Two locations use inline style `color: 'rgba(94,196,182,0.8)'` for badge text — in `sectionHeader` (line ~155) and `desktopSectionHeader` (line ~205)
- Both are inline style objects (not Tailwind classes) — change `color` value to `'rgb(125, 216, 196)'` (`#7dd8c4`)
**Validation:** Contrast check on both badge locations >= 4.5:1. Both use inline styles, not className.

#### S1-07: Audit and fix heading hierarchy (`<h1>` through `<h3>`)
**Files:** `HeroSection.tsx`, `ScrollytellingSection.tsx`, `MidPageCTA.tsx`, `Footer.tsx`, `TeacherParentDashboard.tsx`, `StudentDashboard.tsx`
**Work:**
- Verify `<h1>` appears exactly once on the page (hero headline, `HeroSection.tsx:72`)
- **Critical:** `TeacherParentDashboard.tsx` (line ~74) and `StudentDashboard.tsx` (line ~86) contain `<h1>` elements inside `role="img"` containers. These may still trigger axe heading-hierarchy violations. Change these interior headings to `<div role="heading" aria-level="3">` or plain `<span>` elements since they're decorative
- Verify each `<h2>` follows an `<h1>` (scrollytelling section titles, MidPageCTA)
- Footer category headers use `<h3>` (`Footer.tsx:68`) — verify they follow valid hierarchy
- If any heading level is skipped, insert a visually-hidden heading at the correct level using `sr-only`
**Validation:** Lighthouse heading hierarchy = 0 warnings. Axe heading test passes. Only 1 `<h1>` in DOM.

#### S1-08: Add `aria-hidden="true"` to Navbar mega-menu decorative visuals
**File:** `Navbar.tsx:63-96`
**Work:**
- The `visual` JSX in mega-menu items renders decorative mini-charts (gradient boxes, fake bars)
- These have no semantic meaning and should be hidden from screen readers
- Add `aria-hidden="true"` to each `visual` wrapper div
- **Note:** Dashboard components (`AdminDashboard.tsx`, `TeacherParentDashboard.tsx`, `StudentDashboard.tsx`) already have `role="img"` and `aria-label` — no changes needed there
**Validation:** Axe test: 0 "images must have alternative text" violations. Mega-menu visuals carry `aria-hidden`.

#### S1-09: Verify and fix skip-to-content link
**File:** `LandingPage.tsx:55-60, 64`
**Work:**
- Current skip link: `<a href="#main-content" className="sr-only focus:not-sr-only ...">`
- The `<main id="main-content">` at line 64 does NOT have `tabIndex={-1}`, which means clicking the skip link may not move focus in all browsers. Add `tabIndex={-1}` to `<main>`.
- Write a Vitest + Testing Library test: render LandingPage, simulate tab, assert skip link receives focus, simulate click, assert `document.activeElement` is `#main-content`
**Validation:** Test passes. Manual keyboard test: Tab highlights skip link, Enter moves focus to main.

#### S1-10: Add `aria-current="page"` to active nav links
**Files:** `Navbar.tsx:157-162`, `Footer.tsx:9-29`
**Work:**
- TanStack Router `<Link>` supports `activeProps`
- In `NavLink` component: add `activeProps={{ 'aria-current': 'page' }}` to the `<Link>` call
- In `FooterLink` component: same treatment
**Validation:** Navigate to `/about`, inspect DOM, confirm `aria-current="page"` on matching links.

#### S1-11: Audit AnnouncementBanner accessibility
**File:** `apps/shell/src/components/landing/sections/AnnouncementBanner.tsx`
**Work:**
- Audit contrast of `text-white/95` on teal gradient background — verify >= 4.5:1
- Audit dismiss button: currently likely `p-1` on a small icon (~30px total). Increase to `min-w-[44px] min-h-[44px]` with centered icon
- Add `aria-label="Dismiss announcement"` to the dismiss button if missing
- Add `role="banner"` or `role="status"` to the announcement container
**Validation:** Contrast passes. Dismiss button computed size >= 44x44px. ARIA attributes present.

#### S1-12: Unit test `useReducedMotion` hook
**File:** `apps/shell/src/components/landing/__tests__/useReducedMotion.test.ts` (new)
**Work:**
- The `useReducedMotion` hook at `hooks/useReducedMotion.ts` is used in `ScrollytellingSection` and all three dashboard components — it gates motion-sensitive behavior
- Write tests: mock `window.matchMedia('(prefers-reduced-motion: reduce)')` returning `true` → hook returns `true`; returning `false` → hook returns `false`
- Test dynamic change: simulate `matchMedia` listener callback, assert hook updates
**Validation:** `pnpm vitest useReducedMotion` passes. Both states tested.

---

## Sprint 2: Mobile Responsiveness & Touch UX

**Goal:** Fully usable and polished on 375px (iPhone SE) through 428px (iPhone 14 Pro Max) and 768px (iPad). All interactive targets meet 44x44px minimum.

**Demo:** Open local dev on mobile viewport (Chrome DevTools device mode). Navigate all sections, open/close mobile menu, tap all CTAs without mis-taps.

### Tickets

#### S2-01: Increase mobile hamburger touch target to 44x44px
**File:** `Navbar.tsx:394-400`
**Work:**
- Current: `p-2` = 8px padding on 24px icon = 40px total. Below 44px minimum.
- Change to `min-w-[44px] min-h-[44px] flex items-center justify-center` (explicit sizing)
**Validation:** DevTools confirms computed `width >= 44px` and `height >= 44px`.

#### S2-02: Verify mobile menu link touch targets
**File:** `Navbar.tsx:431-439`
**Work:**
- Current: `min-h-[44px]` is already set — verify it's actually respected by computing height
- If computed height < 44px due to tight content, increase `py-2` to `py-2.5`
- Add `touch-action: manipulation` via Tailwind class `touch-manipulation` on each link
**Validation:** DevTools element inspection: all mobile nav links >= 44px height.

#### S2-03: Hero pillars — improve vertical spacing on mobile
**File:** `HeroSection.tsx:99-113`
**Work:**
- Current: `flex flex-col sm:flex-row` already stacks on mobile (< 640px)
- Vertical stack has `py-2` per pillar = 16px rhythm, too cramped
- Add `gap-4` to the container on mobile (below `sm:`)
- Add `divide-y divide-white/[0.06] sm:divide-y-0` for subtle mobile separators
- Verify total pillar height doesn't push CTA below fold on iPhone SE (375x667)
**Validation:** Visual check at 375px: pillars stack neatly with breathing room. CTA visible above fold.

#### S2-04: Hero CTA button — ensure 48px touch target on mobile
**File:** `HeroSection.tsx:89-96`
**Work:**
- Current: `px-7 py-2.5` = ~40px height, below 48px recommendation for primary mobile CTA
- Bump to `py-3 sm:py-2.5` (mobile-only increase)
- Bump mobile font size: `text-[0.9375rem] sm:text-[0.875rem]`
**Validation:** DevTools confirms button height >= 48px at 375px viewport.

#### S2-05: Scrollytelling mobile pill tabs — add scroll snap and overflow hint
**File:** `ScrollytellingSection.tsx:271-292`
**Work:**
- Add `scroll-snap-type: x mandatory` (via `snap-x snap-mandatory`) on container
- Add `scroll-snap-align: start` (via `snap-start`) on each pill button
- Add right-edge fade gradient overlay (pseudo-element, `pointer-events-none`) to hint more content
- Add `scroll-padding-inline-start: 1rem`
**Validation:** At 375px, pills snap on swipe. Fade visible on right edge.

#### S2-06: Mobile dashboard — horizontal scroll cue for data-dense views
**Files:** `ScrollytellingSection.tsx:327-334`, dashboard components
**Work:**
- Dashboard scales with `transform: scale(0.85)` on mobile
- For any data tables inside dashboards, wrap in `overflow-x-auto` with `scrollbar-hide`
- Add inset shadow on right edge: `box-shadow: inset -12px 0 8px -8px rgba(0,0,0,0.3)` when overflowing
**Validation:** Dashboard tables (if any) are swipeable with visual scroll hint.

#### S2-07: Footer — 1-column on narrow mobile, 2-column on `sm:`
**File:** `Footer.tsx:64`
**Work:**
- Current: `grid-cols-2 md:grid-cols-3` — tight on 320px screens
- Change to `grid-cols-1 sm:grid-cols-2 md:grid-cols-3`
- Verify compliance badges wrap correctly at 375px
**Validation:** Footer clean at 320px and 375px. No text overflow or badge truncation.

#### S2-08: MidPageCTA — full-width buttons on mobile with 48px touch target
**File:** `MidPageCTA.tsx:24-39`
**Work:**
- Add `w-full sm:w-auto` to both CTA links
- Add `min-h-[48px]` to both for mobile touch targets
**Validation:** At 375px, both CTAs span full width with >= 48px height.

#### S2-09: Add `touch-action: manipulation` to landing page
**Files:** `landing.css`
**Work:**
- Add `touch-action: manipulation;` to `.landing-page` rule to disable 300ms tap delay
- Verify `<meta name="viewport" content="width=device-width, initial-scale=1.0">` exists in `index.html` (it does — confirmed)
**Validation:** Tap response is instant on mobile device (no 300ms delay).

#### S2-10: Write responsive layout tests for key breakpoints
**File:** `apps/shell/src/components/landing/__tests__/responsive.test.tsx` (new)
**Work:**
- Create tests rendering HeroSection, Navbar, Footer at 375px, 768px, and 1280px viewport widths
- Mock `window.matchMedia` for each breakpoint
- Assert: hero pillars `flex-direction: column` at 375px, `row` at 768px
- Assert: mobile menu toggle visible at 375px, hidden at 1280px
- Assert: footer grid is 1-col at 375px, 2-col at 768px, 3-col at 1280px
- **Note:** This is a gate ticket — run after S2-01 through S2-09 are complete
**Validation:** `pnpm vitest responsive` all green.

---

## Sprint 3: Spacing System & Hero Section Polish

**Goal:** Implement a strict 8px baseline grid. Refine the hero section visual hierarchy. Polish the Sign In ghost button interaction.

**Demo:** Overlay 8px grid on the page (CSS debug tool) and demonstrate alignment. Hero section is pixel-perfect at desktop and mobile.

### Tickets

#### S3-01: Define 8px spacing scale as CSS custom properties
**File:** `landing.css`
**Work:**
- Add spacing tokens to `.landing-page`:
  ```css
  /* 8px baseline grid spacing scale */
  --lp-space-1: 0.5rem;   /* 8px */
  --lp-space-2: 1rem;     /* 16px */
  --lp-space-3: 1.5rem;   /* 24px */
  --lp-space-4: 2rem;     /* 32px */
  --lp-space-5: 2.5rem;   /* 40px */
  --lp-space-6: 3rem;     /* 48px */
  --lp-space-8: 4rem;     /* 64px */
  --lp-space-10: 5rem;    /* 80px */
  --lp-space-12: 6rem;    /* 96px */
  ```
**Validation:** CSS parses without error. Tokens inspectable in DevTools.

#### S3-02: Increase CTA-to-pillars gap in hero + verify all hero gaps on 8px grid
**File:** `HeroSection.tsx:88,98`
**Work:**
- CTA div: `mb-14 sm:mb-16` (~56-64px) → increase to `mb-16 sm:mb-20` (64-80px)
- Verify badge-to-headline gap: `mb-6` = 24px = 3 * 8px (aligned)
- Verify headline-to-subtitle gap: `mb-6` = 24px = 3 * 8px (aligned)
- Verify subtitle-to-CTA gap: `mb-10` = 40px = 5 * 8px (aligned)
- New CTA-to-pillars: 80px = 10 * 8px (aligned)
**Validation:** All hero vertical gaps are multiples of 8px. Clear breathing room between CTA and pillars.

#### S3-03: Improve "Sign In" ghost button hover and focus state
**File:** `Navbar.tsx:387-392`
**Work:**
- Add `hover:border-white/40` (currently border stays at `border-white/20` on hover)
- Change `transition-colors` to `transition-all` for border transition
- Add `focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent`
**Validation:** Hover: border brightens + bg tints. Tab: visible focus ring.

#### S3-04: Standardize section padding to 8px grid + apply spacing tokens
**Files:** `ScrollytellingSection.tsx:149`, `MidPageCTA.tsx`, `Footer.tsx`
**Work:**
- Scrollytelling mobile header: `pt-12 pb-10` → `pt-12 pb-12` (symmetrical, 48px each)
- MidPageCTA: `var(--lp-section-gap)` = `clamp(4rem, 8vw, 8rem)` — already aligned (64-128px, multiples of 8)
- Footer: `pt-16 pb-12` — already 64px/48px — aligned
- Replace `--lp-section-gap` value with reference to spacing tokens: `clamp(var(--lp-space-8), 8vw, var(--lp-space-12))`
- Add comment in `landing.css`: `/* All section gaps MUST be multiples of 8px */`
**Validation:** DevTools measurement: all section paddings are multiples of 8px.

#### S3-05: Hero gradient text — ensure visible with reduced motion
**Files:** `landing.css:142-156`, `HeroSection.tsx:75-77`
**Work:**
- `hero-gradient-text` uses `background-clip: text` with `-webkit-text-fill-color: transparent`
- With `prefers-reduced-motion: reduce`, the shimmer animation stops but gradient must still render
- Verify: the `@media (prefers-reduced-motion: reduce)` block in `landing.css` does NOT set `animation: none` on `.hero-gradient-text` specifically (it uses a wildcard, which sets `animation-duration: 0.01ms` — gradient still applies, just no motion)
- Write test: render HeroSection with reduced-motion mock, assert hero headline is visible (not transparent/invisible)
**Validation:** Vitest with reduced-motion mock: gradient text renders visibly.

---

## Sprint 4: Content Strategy & Dashboard Visual Refinements

**Goal:** Dashboards are legible at every viewport size and transition smoothly between states. Cognitive load on scroll sections is reduced.

**Demo:** Scroll through all three persona sections (District Leaders, Teachers/Parents, Students). Dashboards are legible at 375px and transition smoothly at 1280px.

### Tickets

#### S4-01: AdminDashboard — ensure chart labels legible at mobile
**File:** `apps/shell/src/components/landing/dashboards/AdminDashboard.tsx`
**Work:**
- Audit all Recharts `<XAxis>`, `<YAxis>` tick labels
- Set `tick={{ fontSize: 11 }}` on any axis without explicit font size
- If legend text < 10px, bump to 11px minimum
- If more than 3 charts visible simultaneously at mobile, hide the least important with `hidden sm:block`
**Validation:** At 375px viewport, all Recharts tick/legend labels have computed `font-size >= 11px`.

#### S4-02: TeacherParentDashboard — ensure mobile legibility
**File:** `apps/shell/src/components/landing/dashboards/TeacherParentDashboard.tsx`
**Work:** Same audit as S4-01. Additionally:
- If any component uses a data table, conditionally render simplified stat cards on mobile via `useMediaQuery('(min-width: 640px)')`
**Validation:** At 375px, all text >= 11px. No horizontal scroll needed.

#### S4-03: StudentDashboard — ensure mobile legibility
**File:** `apps/shell/src/components/landing/dashboards/StudentDashboard.tsx`
**Work:** Same pattern as S4-01/S4-02.
**Validation:** At 375px, all text >= 11px. No horizontal scroll needed.

#### S4-04: Dashboard transition — smooth state morphing with AnimatePresence
**Files:** All three dashboard components
**Work:**
- Verify dashboards animate state transitions via `activeState` prop
- If any state swap causes jarring re-render (layout shift, flash), wrap changing elements in `<AnimatePresence mode="wait">` + `<motion.div>` with `opacity: [0,1]` and `y: [8,0]` transitions
- Duration: 400ms ease-out enter, 200ms exit
- Gate on `useReducedMotion()` — if true, skip animation, swap instantly
**Validation:** Desktop scrollytelling: dashboard state morphs without CLS (measurable via DevTools Performance tab). Reduced motion: instant swap, no animation.

#### S4-05: Verify mega-menu visuals not rendered in mobile menu
**File:** `Navbar.tsx:424-444`
**Work:**
- The mobile menu code path maps over `item.dropdown?.items` and renders icon + title
- Verify `subItem.visual` is NOT referenced in this mobile block (lines 424-444)
- If it is, add guard to skip rendering visuals in mobile layout
**Validation:** At 375px, inspect mobile menu DOM — no decorative visual divs present.

#### S4-06: Add gradient overlay to mobile dashboard container edge
**File:** `ScrollytellingSection.tsx:328`
**Work:**
- Add `relative` to the dashboard container
- Insert a `position: absolute; top: 0` gradient overlay div: `linear-gradient(to bottom, rgb(var(--surface-primary)), transparent 20px)` with `pointer-events-none`
- This feathers the dashboard into the content above, reducing visual weight
**Validation:** Visual check: dashboard blends into section rather than hard border edge.

---

## Sprint 5: Light Mode Theme & Font/Asset Optimization

**Goal:** Landing page has an optional light-mode theme (gated for A/B testing). All assets optimized for production. Lighthouse Performance >= 90.

**Demo:** `/?theme=light` renders a coherent, high-contrast light landing page. Lighthouse all scores >= 90.

**Prerequisite:** Sprint 1 token migration (S1-02, S1-03) must have replaced hardcoded hex colors in `HeroSection.tsx` with CSS variable references. Otherwise, light-mode variable overrides will not reach those elements.

### Tickets

#### S5-01: Migrate remaining hardcoded colors in HeroSection to CSS variables
**File:** `HeroSection.tsx`
**Work:**
- Replace `text-white` on headline `<h1>` (line 72) with `style={{ color: 'rgb(var(--text-primary))' }}`
- Replace `bg-white` on CTA button (line 91) with CSS var approach
- Replace `text-[#0a1a24]` on CTA button with `style={{ color: 'rgb(var(--text-inverted))' }}`
- Replace hardcoded inline gradient hex values in background layers (lines 22, 32, 46-48, 58-59) with CSS custom properties defined on `.landing-page` so light-mode can override them
- This is a prerequisite for all light-mode tickets to work
**Validation:** HeroSection renders identically in dark mode after migration. `grep -r "#" HeroSection.tsx` shows zero hardcoded hex colors in text/bg classes (inline gradient CSS vars are acceptable).

#### S5-02: Define light-mode CSS custom properties for landing page
**File:** `landing.css`
**Work:**
- Add `.landing-page.light` variant:
  ```css
  .landing-page.light {
    background-color: #faf9f7;
    color: #0a1a24;
    --surface-primary: 250 249 247;
    --surface-secondary: 255 255 255;
    --surface-tertiary: 242 240 235;
    --text-primary: 10 26 36;
    --text-secondary: 55 85 100;
    --text-tertiary: 100 115 125;
    --text-inverted: 250 249 247;
    --brand-primary: 0 95 115;
    --brand-secondary: 10 147 150;
    --brand-accent: 238 155 0;
    --lp-chart-primary: #005f73;
    --lp-chart-secondary: #0a9396;
    /* ... adjust shadows for light backgrounds */
  }
  ```
- Override hero gradient layers, mesh grid, glow rotation for light backgrounds
**Validation:** Adding `class="light"` to `.landing-page` div renders coherent light theme with no invisible text.

#### S5-03: Add theme toggle state management hook
**File:** `apps/shell/src/components/landing/hooks/useLandingTheme.ts` (new)
**Work:**
- Create `useLandingTheme()` returning `{ theme: 'dark' | 'light', toggle: () => void }`
- Persist in `localStorage` key `edforge-landing-theme`
- Default to `prefers-color-scheme` if no stored value
- Landing-page scoped only (does not affect authenticated app)
**Validation:** Unit test: toggle flips state, localStorage updated, initial value respects system pref.

#### S5-04: Wire theme toggle into LandingPage layout
**File:** `LandingPage.tsx`
**Work:**
- Import `useLandingTheme`
- Apply `light` class to `.landing-page` div when `theme === 'light'`
- Expose via `?theme=light` URL param for QA (no visible toggle button — behind feature flag)
**Validation:** `/?theme=light` renders light mode. Remove param → dark mode.

#### S5-05: Light-mode hero section gradient overrides
**File:** `landing.css`
**Work:**
- In `.landing-page.light`, override the hero gradient CSS custom properties (defined in S5-01):
  - Base gradient: light warm tones `#faf9f7 → #f0ede6 → #e8e4db → #e0dcd3`
  - Dot grid fill: `rgba(0,0,0,0.04)` instead of white
  - Ambient mesh: brand teal at 3-5% opacity on light
  - Glow rotation: teal/gold at 8% opacity
**Validation:** `/?theme=light` hero has visible but subtle background texture. All text passes WCAG AA.

#### S5-06: Light-mode navbar overrides
**File:** `Navbar.tsx`
**Work:**
- Replace hardcoded `bg-[#0a0a0a]/80` scrolled state with CSS var: `rgb(var(--surface-primary) / 0.9)`
- Replace `text-white` / `text-slate-400` on nav items with CSS var-based styles
- Replace mobile menu `bg-[#0a0a0a]/95` with CSS var
**Validation:** Light-mode navbar text readable, scrolled bg is light, all contrast passes.

#### S5-07: Light-mode footer verification
**File:** `Footer.tsx`
**Work:**
- Footer already uses CSS vars for most colors
- Verify renders correctly in light mode — check compliance badge text, social link icons, copyright text
- Fix any remaining hardcoded colors
**Validation:** `/?theme=light` footer is visually coherent. All text passes WCAG AA.

#### S5-08: Move font loading from CSS `@import` to HTML `<link>` for better CLS
**Files:** `packages/theme/src/base.css:8`, `apps/shell/index.html`
**Work:**
- Remove `@import url('https://fonts.googleapis.com/css2?...')` from `base.css`
- Add to `index.html` `<head>`:
  ```html
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap">
  ```
- This eliminates render-blocking CSS `@import` and enables early font discovery
**Validation:** Lighthouse "Ensure text remains visible during webfont load" passes. No FOIT.

#### S5-09: Add `<link rel="preload">` for critical above-the-fold assets
**File:** `apps/shell/index.html`
**Work:**
- Preload white logo: `<link rel="preload" href="/logo-white.svg" as="image" type="image/svg+xml">`
- These prevent LCP delay on hero elements
**Validation:** Network waterfall shows preloaded assets fetched before DOMContentLoaded.

#### S5-10: Optimize SVG assets and add apple-touch-icon
**Files:** `apps/shell/public/logo.svg`, `apps/shell/public/logo-white.svg`, `apps/shell/index.html`
**Work:**
- Run `svgo` on both logo SVGs
- Generate 180x180 PNG from SVG for apple-touch-icon
- Add `<link rel="apple-touch-icon" href="/apple-touch-icon.png">` to `index.html` (currently missing)
**Validation:** SVGs are smaller post-optimization. Apple touch icon renders on iOS Add to Home Screen.

#### S5-11: Create proper 1200x630 OG social sharing image
**Files:** `apps/shell/public/og-image.png` (new), `apps/shell/index.html`
**Work:**
- Current `og:image` points to `logo.svg` — not a proper social preview image
- Create a 1200x630 static PNG with EdForge branding, tagline, and dark background
- Export as PNG (WebP not universally supported for OG images)
- Update `<meta property="og:image">` to point to new file
- Change `<meta name="twitter:card">` from `summary` to `summary_large_image`
**Validation:** Run URL through opengraph.xyz — preview renders correctly at proper dimensions.

#### S5-12: Add Lighthouse CI performance test script
**Files:** `lighthouserc.js` (new), `package.json`
**Work:**
- Install `@lhci/cli` as devDependency
- Create `lighthouserc.js`:
  - Performance >= 90, Accessibility >= 95, Best Practices >= 90
  - CLS < 0.1, LCP < 2.5s
- Add script: `"lighthouse": "lhci autorun"`
**Validation:** `pnpm lighthouse` runs against dev server and reports scores.

---

## Sprint 6: Cross-Browser QA, Polish & Ship

**Goal:** Final polish, cross-browser verification, and production deploy. Ship a page that loads fast, looks right everywhere, and converts.

**Demo:** Full walkthrough on Chrome, Safari, Firefox (desktop + mobile). Lighthouse all-green. Vercel deploy preview passes smoke test.

### Tickets

#### S6-01: Fix `-webkit-background-clip` standard fallback across codebase
**Files:** `landing.css:152-154`, `Navbar.tsx:239`
**Work:**
- Verify `landing.css` has both `-webkit-background-clip: text` AND `background-clip: text`
- Verify `Navbar.tsx` logo gradient uses both prefixed and unprefixed via Tailwind's `bg-clip-text`
- Ensure `text-transparent` (Tailwind) accompanies `bg-clip-text` everywhere
**Validation:** Gradient text renders in Chrome, Safari, and Firefox.

#### S6-02: Fix iOS Safari rubber-banding on mobile menu
**File:** `Navbar.tsx:406-447`
**Work:**
- Add `overscroll-behavior: contain` (via Tailwind `overscroll-contain`) to mobile menu container
- Add `-webkit-overflow-scrolling: touch` for smooth momentum scrolling on older iOS
**Validation:** iOS Safari (or simulator): mobile menu scrolls without rubber-banding to page behind.

#### S6-03: Validate and fix OG meta tags
**File:** `apps/shell/index.html`
**Work:**
- Verify `og:title`, `og:description`, `og:image` (updated in S5-11), `og:url`, `og:type` are present
- Verify `twitter:card` is now `summary_large_image` (changed in S5-11)
- Verify `og:url` uses canonical domain (`https://edforge.app`)
**Validation:** opengraph.xyz shows correct preview with 1200x630 image.

#### S6-04: Verify and fix robots.txt and sitemap.xml
**Files:** `apps/shell/public/robots.txt`, `apps/shell/public/sitemap.xml`
**Work:**
- Both files already exist and are populated
- Verify `Sitemap:` directive uses canonical URL
- Add `<lastmod>` dates to sitemap entries (currently missing)
- Verify all 6 public routes listed: `/`, `/about`, `/contact`, `/privacy`, `/terms`, `/security`
**Validation:** Fetch both from dev server — valid content with `<lastmod>` dates present.

#### S6-05: Cross-browser visual QA checklist
**Work (QA task, no code output unless issues found):**
- Test on Chrome 120+, Safari 17+ (macOS + iOS), Firefox 120+
- Check: `oklch()` colors, `backdrop-filter`, `background-clip: text`, scroll-snap, `contain: paint`
- If issues found, file as sub-tickets within this sprint
- Capture screenshots for each browser/viewport
**Validation:** No visual regressions. Screenshots documented.

#### S6-06: Vercel deployment preview smoke test
**Work:**
- Push branch, trigger Vercel preview
- Smoke test:
  - [ ] Loads < 3s on throttled 3G
  - [ ] All sections render (hero, 3x scrollytelling, CTA, footer)
  - [ ] Mobile menu opens/closes
  - [ ] All internal links navigate
  - [ ] Zero console errors
  - [ ] Lighthouse thresholds from S5-12 met
**Validation:** All items checked. Lighthouse CI green.

#### S6-07: Final axe-core regression test
**Work:**
- Run full `a11y.test.tsx` suite (from S1-01)
- Assert zero `critical` or `serious` violations
- Document any remaining `moderate`/`minor` as known issues with justification
**Validation:** `pnpm vitest a11y` all green. Zero critical/serious violations.

#### S6-08: Write landing page integration test suite
**File:** `apps/shell/src/components/landing/__tests__/landing.test.tsx` (new)
**Work:**
- Render `LandingPage` in test environment
- Assert: single `<h1>` exists with expected text
- Assert: "Get Started" CTA points to `/login`
- Assert: "Sign In" link present in navbar
- Assert: Footer renders with 4 compliance badges
- Assert: "District Leaders" section text present
- Assert: zero console errors during render
**Validation:** `pnpm vitest landing` all green.

---

## Appendix A: File Reference

| File | Sprint(s) | Description |
|------|-----------|-------------|
| `landing.css` | S1, S2, S3, S5 | Scoped CSS, theme tokens, animations |
| `Navbar.tsx` | S1, S2, S3, S5, S6 | Main nav + mobile menu |
| `Footer.tsx` | S1, S2, S5 | Footer, compliance badges |
| `HeroSection.tsx` | S1, S2, S3, S5 | Above-the-fold hero |
| `ScrollytellingSection.tsx` | S1, S2, S4 | Scroll-linked persona sections |
| `MidPageCTA.tsx` | S2, S3 | Mid-page call to action |
| `BelowFoldSections.tsx` | S4 | Lazy-loaded below-fold wrapper |
| `AnnouncementBanner.tsx` | S1 | Dismissable top banner |
| `SectionTransition.tsx` | — | Decorative gradient divider (`aria-hidden`) — no changes needed |
| `SocialProofSection.tsx` | — | Placeholder gradient divider (`aria-hidden`) — no changes needed |
| `dashboards/*.tsx` | S1, S4 | Recharts dashboard demos |
| `hooks/*.ts` | S1, S2, S5 | Custom hooks (media query, scroll, theme, reduced motion) |
| `pages/LandingPage.tsx` | S1, S5 | Page layout |
| `packages/theme/src/base.css` | S5 | Global theme, font loading |
| `apps/shell/index.html` | S5, S6 | HTML template, meta tags, preloads |
| `apps/shell/public/*` | S5, S6 | Static assets |

## Appendix B: Validation Strategy per Sprint

| Sprint | Primary Validation | Secondary Validation |
|--------|-------------------|---------------------|
| S1 | `pnpm vitest a11y` (axe-core) | Lighthouse accessibility >= 95 |
| S2 | Visual QA at 375px, 768px, 1280px | `pnpm vitest responsive` |
| S3 | 8px grid overlay + DevTools measurements | `pnpm vitest` (gradient visibility test) |
| S4 | Dashboard text >= 11px at 375px | CLS = 0 during state transitions |
| S5 | `/?theme=light` visual QA | Lighthouse performance >= 90 |
| S6 | Cross-browser manual QA | `pnpm vitest` full suite + Lighthouse CI |

## Appendix C: Dependency Graph

```
S1-01 (test harness) ─────────────────────────────────────→ S6-07 (final regression)
S1-02, S1-03 (token migration) ──→ S5-01 (full token migration) ──→ S5-02..S5-07 (light mode)
S3-01 (spacing tokens) ──→ S3-04 (apply tokens)
S2-01..S2-09 (mobile fixes) ──→ S2-10 (responsive tests, gate)
S5-11 (OG image) ──→ S6-03 (OG verification)
S5-12 (Lighthouse CI) ──→ S6-06 (deploy smoke test)
```

## Appendix D: Out of Scope / Future Work

- **`SocialProofSection.tsx`**: Currently a decorative placeholder gradient. Adding actual social proof (logos, testimonials) is a content task, not this sprint plan.
- **Lighthouse CI in GitHub Actions**: S5-12 creates the script; wiring it into CI is a separate infra ticket.
- **`<picture>` element with WebP/AVIF**: Not applicable — current landing page uses zero raster images (all SVG + CSS). The OG image (S5-11) uses PNG for maximum social platform compatibility.
- **A/B testing infrastructure**: S5-02/S5-04 expose `?theme=light` for manual QA. Actual A/B split testing (analytics events, experiment framework) is a separate initiative.
