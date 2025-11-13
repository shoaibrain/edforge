"use client"

import { useState, useCallback } from "react"

export interface StepConfig {
  id: string
  title: string
  description?: string
  optional?: boolean
}

export interface UseStepperProps {
  steps: StepConfig[]
  initialStep?: number
}

export function useStepper({ steps, initialStep = 0 }: UseStepperProps) {
  const [currentStep, setCurrentStep] = useState(initialStep)
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set())

  const nextStep = useCallback(() => {
    if (currentStep < steps.length - 1) {
      setCompletedSteps((prev) => new Set(prev).add(currentStep))
      setCurrentStep((prev) => prev + 1)
    }
  }, [currentStep, steps.length])

  const prevStep = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1)
    }
  }, [currentStep])

  const goToStep = useCallback(
    (stepIndex: number) => {
      if (stepIndex >= 0 && stepIndex < steps.length) {
        setCurrentStep(stepIndex)
      }
    },
    [steps.length],
  )

  const isStepComplete = useCallback((stepIndex: number) => completedSteps.has(stepIndex), [completedSteps])

  const markStepComplete = useCallback((stepIndex: number) => {
    setCompletedSteps((prev) => new Set(prev).add(stepIndex))
  }, [])

  const isFirstStep = currentStep === 0
  const isLastStep = currentStep === steps.length - 1
  const currentStepConfig = steps[currentStep]

  return {
    currentStep,
    currentStepConfig,
    nextStep,
    prevStep,
    goToStep,
    isStepComplete,
    markStepComplete,
    isFirstStep,
    isLastStep,
    totalSteps: steps.length,
    completedSteps,
  }
}
