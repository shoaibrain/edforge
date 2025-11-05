# 🚀 EdForge Quick Start Guide

## What's Been Implemented

### ✅ Enterprise-Grade Design System
- **60-30-10 Color Rule** - Professional, balanced color distribution
- **OKLCH Color Space** - Modern, perceptually uniform colors
- **WCAG AA Compliant** - All colors meet 4.5:1 contrast ratio minimum
- **Light & Dark Mode** - Smooth, system-aware theme switching

### 🎨 Color Palette

#### Brand Colors
- **Primary (Navy Blue)** - `bg-primary text-primary-foreground`
- **Secondary (Deep Teal)** - `bg-secondary text-secondary-foreground`
- **Accent (Bright Cyan)** - `bg-accent text-accent-foreground`

#### Semantic Colors
- **Success** - `bg-success text-success-foreground`
- **Warning** - `bg-warning text-warning-foreground`
- **Error** - `bg-error text-error-foreground`
- **Info** - `bg-info text-info-foreground`

#### UI Colors
- **Muted** - `bg-muted text-muted-foreground`
- **Card** - `bg-card text-card-foreground`
- **Border** - `border-border`

### 📝 Typography
- **Primary Font**: Inter (weights: 300, 400, 500, 600, 700)
- **Monospace Font**: JetBrains Mono (weights: 400, 500, 600)

### 🧩 Components Created
1. **ThemeProvider** - `/src/components/theme-provider.tsx`
2. **ThemeToggle** - `/src/components/theme-toggle.tsx`

---

## Quick Commands

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Start production server
npm run start

# Lint & format code
npm run lint
npm run format
```

---

## Using the Theme

### In Components

```tsx
import { useTheme } from "@/components/theme-provider";

function MyComponent() {
  const { theme, setTheme } = useTheme();
  
  return (
    <button onClick={() => setTheme("dark")}>
      Switch to Dark Mode
    </button>
  );
}
```

### Styling with Tailwind

```tsx
// Primary button
<button className="px-6 py-3 bg-primary text-primary-foreground rounded-lg">
  Primary Action
</button>

// Success alert
<div className="p-4 bg-success/10 border-l-4 border-success text-success-foreground">
  Success message!
</div>

// Card with hover effect
<div className="p-6 bg-card border border-border rounded-lg hover:shadow-lg transition-shadow">
  Card content
</div>
```

---

## Color Usage Guidelines

### 60% - Neutrals (Backgrounds)
- Main page background: `bg-background`
- Card surfaces: `bg-card`
- Subtle sections: `bg-muted`

### 30% - Primary (Navigation & Headers)
- Navigation bars: `bg-primary`
- Primary buttons: `bg-primary`
- Main headings with color: `text-primary`

### 10% - Secondary/Accent (Actions & Highlights)
- Call-to-action buttons: `bg-accent`
- Progress indicators: `bg-secondary`
- Interactive highlights: `text-accent`

---

## Adding shadcn/ui Components

```bash
# Add button component
npx shadcn@latest add button

# Add card component
npx shadcn@latest add card

# Add dialog component
npx shadcn@latest add dialog

# Add form components
npx shadcn@latest add form
npx shadcn@latest add input
npx shadcn@latest add select
```

---

## File Structure

```
src/
├── app/
│   ├── layout.tsx          # Root layout with ThemeProvider
│   ├── page.tsx            # Home page (design showcase)
│   └── globals.css         # Theme tokens & global styles
├── components/
│   ├── theme-provider.tsx  # Theme context
│   └── theme-toggle.tsx    # Light/dark mode toggle
└── lib/
    └── utils.ts            # Utility functions
```

---

## Next Steps

1. **Add Authentication**
   - Implement NextAuth.js or similar
   - Create login/register pages
   
2. **Create Core Modules**
   - Student Management
   - Staff Management
   - Dashboard
   
3. **Set up Database**
   - Add Prisma ORM
   - Design database schema
   - Create migrations

4. **Build Components**
   - Use shadcn/ui as base
   - Customize with EdForge theme
   - Create reusable patterns

---

## Resources

- 📘 [Complete Design System](./DESIGN_SYSTEM.md)
- 📖 [Full README](./README.md)
- 🎨 [Tailwind CSS v4 Docs](https://tailwindcss.com)
- 🧩 [shadcn/ui Components](https://ui.shadcn.com)

---

## Support

For questions or issues:
1. Check [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) for design guidelines
2. Review [README.md](./README.md) for project documentation
3. Visit the live showcase at [http://localhost:3000](http://localhost:3000)

---

**Happy Building! 🎓**

