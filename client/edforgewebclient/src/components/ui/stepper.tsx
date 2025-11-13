"use client"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

interface StepperProps {
  steps: Array<{
    id: string
    title: string
    description?: string
    optional?: boolean
  }>
  currentStep: number
  completedSteps: Set<number>
  onStepClick?: (stepIndex: number) => void
}

export function Stepper({ steps, currentStep, completedSteps, onStepClick }: StepperProps) {
  return (
    <nav aria-label="Progress">
      <ol role="list" className="flex items-start">
        {steps.map((step, stepIdx) => {
          const isCompleted = completedSteps.has(stepIdx)
          const isCurrent = stepIdx === currentStep
          const isPast = stepIdx < currentStep

          return (
            <li key={step.id} className={cn("relative flex-1", stepIdx !== steps.length - 1 && "pr-8")}>
              {/* Connector Line */}
              {stepIdx !== steps.length - 1 && (
                <div
                  className={cn(
                    "absolute left-10 top-5 h-0.5 w-[calc(100%-2.5rem)] -translate-y-1/2",
                    "transition-colors duration-300",
                    isPast || isCompleted ? "bg-primary" : "bg-border",
                  )}
                  aria-hidden="true"
                />
              )}

              <button
                type="button"
                onClick={() => onStepClick?.(stepIdx)}
                disabled={!isPast && !isCurrent}
                className={cn(
                  "group relative flex flex-col items-start w-full",
                  "disabled:cursor-not-allowed",
                  (isPast || isCurrent) && "cursor-pointer",
                )}
              >
                <span className="flex items-center">
                  <span
                    className={cn(
                      "relative flex h-10 w-10 items-center justify-center rounded-full",
                      "transition-all duration-300",
                      "border-2",
                      isCompleted && "border-primary bg-primary text-primary-foreground shadow-sm",
                      isCurrent &&
                        !isCompleted &&
                        "border-primary bg-background text-primary shadow-[0_0_0_4px_hsl(var(--primary)/0.1)] ring-2 ring-primary/20",
                      !isCurrent && !isCompleted && "border-border bg-card text-muted-foreground",
                    )}
                  >
                    {isCompleted ? (
                      <Check className="h-5 w-5" aria-hidden="true" />
                    ) : (
                      <span className="text-sm font-semibold">{stepIdx + 1}</span>
                    )}
                  </span>
                </span>
                <span className="mt-2.5 flex min-w-0 flex-col">
                  <span
                    className={cn(
                      "text-sm font-semibold transition-colors",
                      isCurrent ? "text-primary" : isCompleted ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {step.title}
                  </span>
                  {step.description && (
                    <span
                      className={cn(
                        "text-xs mt-0.5 transition-colors",
                        isCurrent ? "text-muted-foreground" : "text-muted-foreground/70",
                      )}
                    >
                      {step.description}
                    </span>
                  )}
                  {step.optional && <span className="text-xs text-muted-foreground/70 mt-0.5">Optional</span>}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
