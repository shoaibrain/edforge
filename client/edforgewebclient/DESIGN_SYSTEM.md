# EdForge EMIS Design System

## 🎨 Enterprise-Grade UI/UX Foundation

This document outlines the design system for EdForge, a modern, enterprise-grade Education Management Information System (EMIS) built with Next.js 15, Tailwind CSS v4, and shadcn/ui.

---

## 📐 Design Philosophy

### Core Principles

1. **60-30-10 Color Rule**
   - 60% Neutrals (Off-white, Light Gray) - Main backgrounds and surfaces
   - 30% Primary (Navy Blue) - Navigation, headers, primary actions
   - 10% Secondary/Accent (Teal, Cyan) - CTAs, highlights, progress indicators

2. **WCAG AA Compliance**
   - All color combinations meet minimum **4.5:1 contrast ratio**
   - Accessible to users with visual impairments
   - Enterprise-grade readability standards

3. **Modern OKLCH Color Space**
   - Perceptually uniform colors
   - Better dark mode color transformations
   - Future-proof color management

4. **Professional & Elegant**
   - Clean, minimalist design
   - Ample whitespace (negative space)
   - Focus on content hierarchy and clarity

---

## 🎨 Color Palette

### Brand Colors

#### Primary - Navy Blue (Trust & Stability)
```css
/* Light Mode */
--primary: oklch(0.42 0.08 255);           /* #005B99 - Royal Blue */
--primary-foreground: oklch(0.99 0 0);     /* White text */

/* Dark Mode */
--primary: oklch(0.68 0.15 240);           /* #3B82F6 - Bright Blue */
--primary-foreground: oklch(0.99 0 0);
```

**Usage:** Primary buttons, navigation bars, headers, key structural elements

#### Secondary - Deep Teal (Growth & Balance)
```css
/* Light Mode */
--secondary: oklch(0.52 0.09 195);         /* #008080 - Deep Teal */
--secondary-foreground: oklch(0.99 0 0);

/* Dark Mode */
--secondary: oklch(0.60 0.12 195);         /* Bright Teal */
--secondary-foreground: oklch(0.99 0 0);
```

**Usage:** Secondary actions, progress indicators, educational elements

#### Accent - Bright Cyan (Action & Focus)
```css
/* Light Mode */
--accent: oklch(0.72 0.14 220);            /* #00B8FF - Bright Cyan */
--accent-foreground: oklch(0.99 0 0);

/* Dark Mode */
--accent: oklch(0.68 0.12 220);            /* Desaturated Cyan */
--accent-foreground: oklch(0.99 0 0);
```

**Usage:** Call-to-action buttons, interactive highlights, attention-grabbing elements

### Neutral Colors (60% of UI)

#### Background
```css
/* Light Mode */
--background: oklch(0.99 0 0);             /* #FCFCFC - Off-white */

/* Dark Mode */
--background: oklch(0.17 0.01 255);        /* #0A1628 - Deep navy-black */
```

#### Foreground (Text)
```css
/* Light Mode */
--foreground: oklch(0.25 0.015 255);       /* #102E4A - Navy text */

/* Dark Mode */
--foreground: oklch(0.95 0.005 255);       /* Off-white text */
```

#### Card Surfaces
```css
/* Light Mode */
--card: oklch(1 0 0);                      /* Pure white */
--card-foreground: oklch(0.25 0.015 255);

/* Dark Mode */
--card: oklch(0.22 0.015 255);             /* Elevated dark surface */
--card-foreground: oklch(0.95 0.005 255);
```

#### Muted (Subtle Backgrounds)
```css
/* Light Mode */
--muted: oklch(0.96 0.002 255);            /* #F5F5F6 - Light Gray */
--muted-foreground: oklch(0.50 0.02 255);

/* Dark Mode */
--muted: oklch(0.27 0.02 255);
--muted-foreground: oklch(0.65 0.02 255);
```

### Semantic Colors (WCAG AA Compliant)

#### Success - Green
```css
/* Light Mode */
--success: oklch(0.58 0.15 155);           /* #0F9D58 */
--success-foreground: oklch(0.99 0 0);

/* Dark Mode */
--success: oklch(0.65 0.14 155);
--success-foreground: oklch(0.99 0 0);
```

**Usage:** Success messages, positive confirmations, completed states

#### Warning - Amber
```css
/* Light Mode */
--warning: oklch(0.70 0.16 75);            /* #F59E0B */
--warning-foreground: oklch(0.20 0.01 75);

/* Dark Mode */
--warning: oklch(0.75 0.14 75);
--warning-foreground: oklch(0.20 0.01 75);
```

**Usage:** Warning messages, caution alerts, review-required states

#### Error - Red
```css
/* Light Mode */
--error: oklch(0.55 0.22 25);              /* #DC2626 */
--error-foreground: oklch(0.99 0 0);

/* Dark Mode */
--error: oklch(0.62 0.20 25);
--error-foreground: oklch(0.99 0 0);
```

**Usage:** Error messages, destructive actions, critical alerts

#### Info - Blue
```css
/* Light Mode */
--info: oklch(0.60 0.15 250);              /* #2563EB */
--info-foreground: oklch(0.99 0 0);

/* Dark Mode */
--info: oklch(0.65 0.13 250);
--info-foreground: oklch(0.99 0 0);
```

**Usage:** Informational messages, helpful tips, neutral notifications

### UI Element Colors

#### Borders & Inputs
```css
/* Light Mode */
--border: oklch(0.90 0.003 255);           /* #E5E5E8 - Light border */
--input: oklch(0.90 0.003 255);
--ring: oklch(0.42 0.08 255);              /* Focus ring (Primary) */

/* Dark Mode */
--border: oklch(0.35 0.02 255);            /* Subtle dark border */
--input: oklch(0.30 0.02 255);
--ring: oklch(0.68 0.15 240);
```

### Chart Colors (Data Visualization)

Designed for educational metrics and analytics:

```css
/* Light Mode */
--chart-1: oklch(0.60 0.20 25);            /* Warm Red */
--chart-2: oklch(0.65 0.18 155);           /* Green */
--chart-3: oklch(0.65 0.20 255);           /* Blue */
--chart-4: oklch(0.70 0.18 75);            /* Amber */
--chart-5: oklch(0.60 0.15 285);           /* Purple */

/* Dark Mode */
--chart-1: oklch(0.65 0.18 25);
--chart-2: oklch(0.70 0.16 155);
--chart-3: oklch(0.70 0.18 255);
--chart-4: oklch(0.75 0.16 75);
--chart-5: oklch(0.65 0.13 285);
```

---

## 📝 Typography System

### Font Families

#### Primary Font: **Inter**
- **Usage:** UI text, body content, headings
- **Weights:** 300 (Light), 400 (Regular), 500 (Medium), 600 (Semibold), 700 (Bold)
- **Rationale:** Highly legible, modern, optimized for digital interfaces

#### Monospace Font: **JetBrains Mono**
- **Usage:** Code blocks, technical data, monospaced content
- **Weights:** 400 (Regular), 500 (Medium), 600 (Semibold)
- **Rationale:** Clean, professional, excellent for technical content

### Type Scale

```css
/* Display / Hero */
h1 { font-size: 3.5rem;   /* 56px */ font-weight: 700; line-height: 1.1; }

/* Section Heading */
h2 { font-size: 3rem;     /* 48px */ font-weight: 700; line-height: 1.2; }

/* Subsection Heading */
h3 { font-size: 2rem;     /* 32px */ font-weight: 600; line-height: 1.3; }

/* Card/Component Heading */
h4 { font-size: 1.5rem;   /* 24px */ font-weight: 600; line-height: 1.4; }

/* Subheading */
h5 { font-size: 1.25rem;  /* 20px */ font-weight: 600; line-height: 1.5; }

/* Small Heading */
h6 { font-size: 1rem;     /* 16px */ font-weight: 600; line-height: 1.5; }

/* Body Large */
.text-lg { font-size: 1.125rem; /* 18px */ line-height: 1.6; }

/* Body Default */
.text-base { font-size: 1rem; /* 16px */ line-height: 1.5; }

/* Small Text */
.text-sm { font-size: 0.875rem; /* 14px */ line-height: 1.5; }

/* Extra Small */
.text-xs { font-size: 0.75rem; /* 12px */ line-height: 1.4; }
```

### Typography Best Practices

1. **Hierarchy:** Use heading sizes to establish clear content hierarchy
2. **Line Length:** Optimal line length: 60-75 characters for readability
3. **Spacing:** Use consistent vertical rhythm (1.5-1.6 line-height for body)
4. **Contrast:** Ensure text meets WCAG AA standards (4.5:1 minimum)

---

## 🧩 Component Patterns

### Buttons

#### Primary Button
```tsx
<button className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity">
  Primary Action
</button>
```

#### Secondary Button
```tsx
<button className="px-6 py-3 bg-secondary text-secondary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity">
  Secondary Action
</button>
```

#### Accent/CTA Button
```tsx
<button className="px-6 py-3 bg-accent text-accent-foreground rounded-lg font-medium hover:opacity-90 transition-opacity">
  Call to Action
</button>
```

#### Outline Button
```tsx
<button className="px-6 py-3 border border-border rounded-lg font-medium hover:bg-muted transition-colors">
  Outline Action
</button>
```

#### Destructive Button
```tsx
<button className="px-6 py-3 bg-destructive text-destructive-foreground rounded-lg font-medium hover:opacity-90 transition-opacity">
  Delete
</button>
```

### Cards

#### Default Card
```tsx
<div className="p-6 rounded-lg border border-border bg-card">
  <h3 className="text-lg font-semibold mb-2">Card Title</h3>
  <p className="text-muted-foreground">Card content goes here</p>
</div>
```

#### Elevated Card (with shadow)
```tsx
<div className="p-6 rounded-lg border border-border bg-card shadow-lg hover:shadow-xl transition-shadow">
  <h3 className="text-lg font-semibold mb-2">Elevated Card</h3>
  <p className="text-muted-foreground">Content with elevation</p>
</div>
```

### Form Inputs

#### Text Input
```tsx
<input
  type="text"
  placeholder="Enter text..."
  className="w-full px-3 py-2 border border-input rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring"
/>
```

#### Select Dropdown
```tsx
<select className="w-full px-3 py-2 border border-input rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring">
  <option>Option 1</option>
  <option>Option 2</option>
</select>
```

### Alerts & Notifications

#### Success Alert
```tsx
<div className="p-4 rounded-lg border-l-4 border-success bg-success/10 text-success-foreground flex items-start gap-2">
  <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
  <span>Success message</span>
</div>
```

#### Warning Alert
```tsx
<div className="p-4 rounded-lg border-l-4 border-warning bg-warning/10 text-warning-foreground flex items-start gap-2">
  <AlertTriangle className="h-5 w-5 flex-shrink-0" />
  <span>Warning message</span>
</div>
```

#### Error Alert
```tsx
<div className="p-4 rounded-lg border-l-4 border-error bg-error/10 text-error-foreground flex items-start gap-2">
  <AlertCircle className="h-5 w-5 flex-shrink-0" />
  <span>Error message</span>
</div>
```

#### Info Alert
```tsx
<div className="p-4 rounded-lg border-l-4 border-info bg-info/10 text-info-foreground flex items-start gap-2">
  <Info className="h-5 w-5 flex-shrink-0" />
  <span>Info message</span>
</div>
```

---

## 🌓 Dark Mode

### Implementation

EdForge uses a sophisticated dark mode implementation:

1. **Theme Provider:** React context-based theme management
2. **System Preference:** Respects user's OS theme preference
3. **Manual Toggle:** Users can override with light/dark/system preference
4. **Persistent:** Theme preference saved to localStorage
5. **Smooth Transitions:** 200ms transitions for theme switching

### Usage

```tsx
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";

// In your layout
<ThemeProvider defaultTheme="system" storageKey="edforge-ui-theme">
  {children}
</ThemeProvider>

// Theme toggle component
<ThemeToggle />
```

### Hook Usage

```tsx
import { useTheme } from "@/components/theme-provider";

function MyComponent() {
  const { theme, setTheme } = useTheme();
  
  return (
    <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
      Toggle Theme
    </button>
  );
}
```

---

## 📏 Spacing System

Consistent spacing using Tailwind's spacing scale:

```
4px   - 1  - Micro spacing (icon padding)
8px   - 2  - Tight spacing (inline elements)
12px  - 3  - Small spacing (form element gaps)
16px  - 4  - Base spacing (component padding)
20px  - 5  - Medium spacing (card padding)
24px  - 6  - Large spacing (section gaps)
32px  - 8  - XL spacing (section padding)
48px  - 12 - 2XL spacing (major sections)
64px  - 16 - 3XL spacing (page sections)
```

---

## 🎯 Border Radius

Modern, consistent rounded corners:

```css
--radius-sm: calc(var(--radius) - 4px);    /* 4px  - Small elements */
--radius-md: calc(var(--radius) - 2px);    /* 6px  - Medium elements */
--radius-lg: var(--radius);                 /* 8px  - Default (Base) */
--radius-xl: calc(var(--radius) + 4px);    /* 12px - Large cards */
--radius-2xl: calc(var(--radius) + 8px);   /* 16px - Hero elements */
```

---

## ♿ Accessibility

### WCAG AA Compliance

All color combinations meet **WCAG AA standards**:
- Normal text: **4.5:1** contrast ratio minimum
- Large text: **3:1** contrast ratio minimum
- UI components: **3:1** contrast ratio minimum

### Focus Management

- Visible focus indicators on all interactive elements
- Focus ring using primary color: `focus:ring-2 focus:ring-ring`
- Focus offset for better visibility: `focus:ring-offset-2`

### Keyboard Navigation

- All interactive elements are keyboard accessible
- Logical tab order throughout the application
- Skip links for main content navigation

### Screen Reader Support

- Semantic HTML elements
- ARIA labels where necessary
- Alternative text for images and icons

---

## 📱 Responsive Design

Mobile-first approach with breakpoints:

```css
sm:  640px   /* Small devices (large phones) */
md:  768px   /* Medium devices (tablets) */
lg:  1024px  /* Large devices (laptops) */
xl:  1280px  /* Extra large devices (desktops) */
2xl: 1536px  /* 2X large devices (large desktops) */
```

### Best Practices

1. Design mobile-first, progressively enhance for larger screens
2. Use responsive grid layouts (1 column → 2 columns → 4 columns)
3. Adjust typography scale for smaller screens
4. Ensure touch targets are at least 44x44px on mobile

---

## 🚀 Performance Considerations

1. **Font Loading:** Using `display: swap` for font loading strategy
2. **Color Transitions:** 200ms for smooth theme switching
3. **CSS Variables:** Fast, dynamic theme switching
4. **OKLCH Color Space:** Modern, perceptually uniform colors

---

## 📚 Resources

- **Tailwind CSS v4 Documentation:** https://tailwindcss.com
- **shadcn/ui Components:** https://ui.shadcn.com
- **OKLCH Color Picker:** https://oklch.com
- **WCAG Contrast Checker:** https://webaim.org/resources/contrastchecker/

---

## 📄 License

This design system is part of EdForge EMIS.

