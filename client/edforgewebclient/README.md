# 🎓 EdForge - Enterprise Education Management System

<div align="center">

![EdForge Logo](https://img.shields.io/badge/EdForge-EMIS-0059b3?style=for-the-badge)
[![Next.js](https://img.shields.io/badge/Next.js-15.5.4-black?style=for-the-badge&logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38B2AC?style=for-the-badge&logo=tailwind-css)](https://tailwindcss.com)

**Modern, enterprise-grade Education Management Information System (EMIS) with world-class UI/UX**

[Features](#-features) • [Getting Started](#-getting-started) • [Design System](#-design-system) • [Documentation](#-documentation)

</div>

---

## 📋 Overview

EdForge is a **multi-tenant SaaS platform** designed for educational institutions to manage students, staff, curriculum, and institutional operations with an intuitive, professional, and accessible user interface.

### ✨ Key Highlights

- 🎨 **Enterprise-Grade UI/UX** - Professional design following 60-30-10 color rule
- ♿ **WCAG AA Compliant** - Accessible to all users with 4.5:1 contrast ratios
- 🌓 **Dark Mode** - System-aware theme with smooth transitions
- 🎯 **Modern Tech Stack** - Next.js 15, React 19, TypeScript, Tailwind CSS v4
- 🚀 **Performance First** - Built with Turbopack for lightning-fast builds
- 📱 **Responsive Design** - Mobile-first approach for all screen sizes
- 🎨 **OKLCH Color Space** - Perceptually uniform, future-proof colors

---

## 🚀 Features

### Core Platform Capabilities

- **Student Management** - Comprehensive student profiles, enrollment, and records
- **Staff Management** - Employee data, roles, and permissions
- **Curriculum Planning** - Design and manage educational programs
- **Analytics & Reports** - Data-driven insights for institutional decisions
- **Multi-tenant Architecture** - Secure isolation for multiple institutions
- **Role-Based Access Control** - Fine-grained permissions system

### Design System

- **Professional Color Palette**
  - Primary: Navy Blue (Trust & Stability)
  - Secondary: Deep Teal (Growth & Balance)
  - Accent: Bright Cyan (Action & Focus)
  - Semantic Colors: Success, Warning, Error, Info
  
- **Enterprise Typography**
  - Primary: Inter (UI & Content)
  - Monospace: JetBrains Mono (Code & Technical)
  
- **Component Library**
  - Built with shadcn/ui
  - Fully customizable and accessible
  - Consistent design tokens

---

## 🛠 Tech Stack

| Category | Technology |
|----------|-----------|
| **Framework** | [Next.js 15](https://nextjs.org) with App Router |
| **Language** | [TypeScript 5](https://www.typescriptlang.org/) |
| **Styling** | [Tailwind CSS v4](https://tailwindcss.com) |
| **UI Components** | [shadcn/ui](https://ui.shadcn.com) |
| **Icons** | [Lucide React](https://lucide.dev) |
| **Linting & Formatting** | [Biome](https://biomejs.dev) |
| **Build Tool** | [Turbopack](https://turbo.build/pack) |

---

## 📦 Getting Started

### Prerequisites

- **Node.js**: v20 or higher
- **npm**: v11.4.2 or higher (or yarn/pnpm)

### Installation

This project is part of a monorepo. Clone the entire repository:

1. **Clone the repository**
   ```bash
   git clone https://github.com/shoaibrain/edforge.git
   cd edforge
   ```

2. **Install dependencies** (from root)
   ```bash
   npm install
   ```
   This installs dependencies for all workspace packages including shared-types.

3. **Build shared-types** (required dependency)
   ```bash
   npm run build:shared-types
   ```

4. **Run the development server**
   ```bash
   npm run dev:client
   # Or from client/edforgewebclient directory:
   cd client/edforgewebclient
   npm run dev
   ```

5. **Open your browser**
   
   Navigate to [http://localhost:3000](http://localhost:3000)

### Available Scripts

```bash
# Development server with Turbopack
npm run dev

# Production build
npm run build

# Start production server
npm run start

# Lint code with Biome
npm run lint

# Format code with Biome
npm run format
```

---

## 🎨 Design System

### Color Philosophy

EdForge follows the **60-30-10 rule** for optimal visual hierarchy:

- **60% Neutrals** - Off-white backgrounds, light gray surfaces
- **30% Primary** - Navy blue for navigation, headers, primary actions
- **10% Secondary/Accent** - Teal and cyan for CTAs and highlights

### WCAG AA Compliance

All color combinations meet **WCAG AA accessibility standards**:
- Normal text: 4.5:1 contrast ratio minimum
- Large text: 3:1 contrast ratio minimum
- UI components: 3:1 contrast ratio minimum

### Theme System

- **Light Mode** - Clean, professional, optimal for daylight
- **Dark Mode** - Eye-friendly, elegant, reduced eye strain
- **System Mode** - Respects OS preference automatically

For complete design system documentation, see [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md)

---

## 📂 Project Structure

This project is part of the EdForge monorepo. The structure is:

```
edforge/                          # Monorepo root
├── client/
│   └── edforgewebclient/        # This Next.js application
│       ├── src/
│       │   ├── app/             # Next.js App Router
│       │   ├── components/      # React components
│       │   └── lib/             # Utility functions
│       ├── public/              # Static assets
│       └── package.json
├── server/
│   └── application/             # Backend microservices
├── packages/
│   └── shared-types/            # Shared TypeScript types
└── package.json                 # Root workspace config
```

### Shared Types

This frontend uses shared types from `packages/shared-types/`. The build process automatically builds shared-types before building the frontend (see `prebuild` script in `package.json`).

---

## 🎯 Design Principles

### 1. User-Centric
- Intuitive navigation and clear information hierarchy
- Minimal cognitive load with ample whitespace
- Consistent patterns across the application

### 2. Accessible
- WCAG AA compliance for all users
- Keyboard navigation support
- Screen reader compatible

### 3. Professional
- Enterprise-grade visual design
- Modern, clean aesthetic
- Trust and stability through color choices

### 4. Performant
- Fast page loads with Turbopack
- Optimized font loading
- Efficient CSS with Tailwind v4

---

## 🧩 Component Development

### Using shadcn/ui

EdForge uses shadcn/ui for component primitives. To add new components:

```bash
npx shadcn@latest add button
npx shadcn@latest add card
npx shadcn@latest add dialog
```

### Component Style Guide

```tsx
// Example: Creating a custom button
import { cn } from "@/lib/utils";

export function CustomButton({ className, ...props }) {
  return (
    <button
      className={cn(
        "px-6 py-3 bg-primary text-primary-foreground",
        "rounded-lg font-medium",
        "hover:opacity-90 transition-opacity",
        "focus:outline-none focus:ring-2 focus:ring-ring",
        className
      )}
      {...props}
    />
  );
}
```

---

## 🚀 Deployment

### Automatic Deployment (CI/CD)

This application is automatically deployed to **Vercel** when changes are pushed to the `main` branch. The GitHub Actions workflow (`.github/workflows/frontend-deploy.yml`) handles:

- Building shared-types
- Type checking
- Linting
- Building Next.js application
- Deploying to Vercel

See [VERCEL_SETUP.md](../../VERCEL_SETUP.md) for detailed setup instructions.

### Manual Deployment

1. **Via Vercel Dashboard**: Connect GitHub repository and configure
2. **Via Vercel CLI**: 
   ```bash
   cd client/edforgewebclient
   vercel --prod
   ```

### Environment Variables

For local development, create a `.env.local` file in `client/edforgewebclient/`:

```env
# App Configuration
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Authentication (Cognito)
NEXT_PUBLIC_CLIENT_ID=your_cognito_client_id
NEXT_PUBLIC_ISSUER=your_cognito_issuer
NEXT_PUBLIC_WELL_KNOWN_ENDPOINT_URL=your_well_known_endpoint
NEXTAUTH_SECRET=your_secret
NEXTAUTH_URL=http://localhost:3000

# API Configuration
NEXT_PUBLIC_API_URL=http://localhost:3001
```

For production, configure these in Vercel Dashboard → Project Settings → Environment Variables.

---

## 🚧 Roadmap

### Phase 1: Foundation (Current)
- [x] Design system implementation
- [x] Theme provider (light/dark mode)
- [x] Typography system
- [x] Color palette (WCAG compliant)
- [x] Component showcase

### Phase 2: Core Features (Next)
- [ ] Authentication & Authorization
- [ ] Student Management Module
- [ ] Staff Management Module
- [ ] Dashboard & Analytics
- [ ] Multi-tenant Architecture

### Phase 3: Advanced Features
- [ ] Curriculum Management
- [ ] Attendance Tracking
- [ ] Grade Management
- [ ] Report Generation
- [ ] Communication Tools

### Phase 4: Integrations
- [ ] Payment Gateway
- [ ] Email Notifications
- [ ] SMS Integration
- [ ] Export/Import Tools
- [ ] API Documentation

---

## 🤝 Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

### Code Style

- Use TypeScript for all new code
- Follow Biome linting rules
- Ensure WCAG AA compliance for UI changes
- Write descriptive commit messages

---

## 📖 Documentation

- **[Design System Guide](./DESIGN_SYSTEM.md)** - Complete design system documentation
- **[Next.js Documentation](https://nextjs.org/docs)** - Learn about Next.js features
- **[Tailwind CSS v4](https://tailwindcss.com)** - Styling documentation
- **[shadcn/ui](https://ui.shadcn.com)** - Component library

---

## 📄 License

This project is part of EdForge EMIS. All rights reserved.

