"use client"

import { useState } from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useStepper } from "@/hooks/use-stepper"
import { Stepper } from "@/components/ui/stepper"
import { StudentInformationStep } from "./steps/student-information-step"
import { ContactDetailsStep } from "./steps/contact-details-step"
import { AcademicsStep } from "./steps/academics-step"
import { ReviewFinalizeStep } from "./steps/review-finalize-step"

const ENROLLMENT_STEPS = [
  {
    id: "student-info",
    title: "Student Information",
    description: "Basic details",
  },
  {
    id: "contact-details",
    title: "Contact Details",
    description: "Address & guardians",
  },
  {
    id: "academics",
    title: "Academics",
    description: "Grade & tuition",
  },
  {
    id: "review",
    title: "Review & Finalize",
    description: "Confirm enrollment",
  },
]

export interface EnrollmentFormData {
  // Student Information
  firstName: string
  middleName?: string
  lastName: string
  dateOfBirth: string
  gender: string
  nationalId?: string
  bloodType?: string
  nationality: string

  // Contact Details
  email: string
  phone: string
  addresses: Array<{
    id: string
    type: "home" | "mailing"
    street: string
    city: string
    state: string
    postalCode: string
    country: string
    isPrimary: boolean
  }>
  parents: Array<{
    id: string
    firstName: string
    lastName: string
    relationship: string
    email: string
    phone: string
    occupation?: string
    isPrimaryGuardian: boolean
    isEmergencyContact: boolean
    sameAddressAsStudent: boolean
    addresses: Array<{
      id: string
      type: "home" | "mailing"
      street: string
      city: string
      state: string
      postalCode: string
      country: string
      isPrimary: boolean
    }>
  }>

  // Academics
  grade: string
  enrollmentDate: string
  previousSchool?: string
  previousSchoolAddress?: string
  specialNeeds?: string
  medicalConditions?: string

  // Payment
  tuitionOption: "full" | "installment"
}

interface StudentEnrollmentFormProps {
  onClose: () => void
}

export function StudentEnrollmentForm({ onClose }: StudentEnrollmentFormProps) {
  const stepper = useStepper({
    steps: ENROLLMENT_STEPS,
    initialStep: 0,
  })

  const [formData, setFormData] = useState<EnrollmentFormData>({
    firstName: "",
    lastName: "",
    dateOfBirth: "",
    gender: "",
    nationality: "",
    email: "",
    phone: "",
    addresses: [
      {
        id: Math.random().toString(36).substr(2, 9),
        type: "home",
        street: "",
        city: "",
        state: "",
        postalCode: "",
        country: "",
        isPrimary: true,
      },
    ],
    parents: [],
    grade: "",
    enrollmentDate: new Date().toISOString().split("T")[0],
    tuitionOption: "installment",
  })

  const updateFormData = (data: Partial<EnrollmentFormData>) => {
    setFormData((prev) => ({ ...prev, ...data }))
  }

  const handleNext = () => {
    stepper.markStepComplete(stepper.currentStep)
    stepper.nextStep()
  }

  const handlePrev = () => {
    stepper.prevStep()
  }

  const renderStep = () => {
    switch (stepper.currentStep) {
      case 0:
        return <StudentInformationStep data={formData} updateData={updateFormData} onNext={handleNext} />
      case 1:
        return (
          <ContactDetailsStep data={formData} updateData={updateFormData} onNext={handleNext} onPrev={handlePrev} />
        )
      case 2:
        return <AcademicsStep data={formData} updateData={updateFormData} onNext={handleNext} onPrev={handlePrev} />
      case 3:
        return <ReviewFinalizeStep data={formData} onPrev={handlePrev} onComplete={onClose} />
      default:
        return null
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="border-b border-border bg-card sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Student Enrollment</h1>
              <p className="text-sm text-muted-foreground mt-0.5">Complete all steps to enroll a new student</p>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} className="hover:bg-muted">
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Stepper */}
      <div className="border-b border-border bg-muted/30">
        <div className="max-w-6xl mx-auto px-8 py-6">
          <Stepper
            steps={ENROLLMENT_STEPS}
            currentStep={stepper.currentStep}
            completedSteps={stepper.completedSteps}
            onStepClick={stepper.goToStep}
          />
        </div>
      </div>

      {/* Form Content */}
      <div className="flex-1 max-w-6xl mx-auto w-full px-8 py-8">
        {renderStep()}
      </div>
    </div>
  )
}
