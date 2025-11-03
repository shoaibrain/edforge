import { Header } from "./Header"
import type { ReactNode } from "react"

interface PageLayoutProps {
  children: ReactNode
}

export async function PageLayout({ children }: PageLayoutProps) {
  return (
    <div className="relative flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <div className="container py-6">{children}</div>
      </main>
    </div>
  )
}

