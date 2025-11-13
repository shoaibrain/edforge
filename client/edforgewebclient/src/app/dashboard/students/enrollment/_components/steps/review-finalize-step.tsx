"use client"

import { useState } from "react"
import { CheckCircle2, Download, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import type { EnrollmentFormData } from "../student-enrollment-form"

interface ReviewFinalizeStepProps {
  data: EnrollmentFormData
  onPrev: () => void
  onComplete: () => void
}

const TUITION_RATES: Record<string, number> = {
  "grade-k": 8500,
  "grade-1": 9000,
  "grade-2": 9000,
  "grade-3": 9500,
  "grade-4": 9500,
  "grade-5": 9500,
  "grade-6": 10000,
  "grade-7": 10000,
  "grade-8": 10000,
  "grade-9": 11000,
  "grade-10": 11000,
  "grade-11": 11500,
  "grade-12": 11500,
}

const GRADE_LABELS: Record<string, string> = {
  "grade-k": "Kindergarten",
  "grade-1": "Grade 1",
  "grade-2": "Grade 2",
  "grade-3": "Grade 3",
  "grade-4": "Grade 4",
  "grade-5": "Grade 5",
  "grade-6": "Grade 6",
  "grade-7": "Grade 7",
  "grade-8": "Grade 8",
  "grade-9": "Grade 9",
  "grade-10": "Grade 10",
  "grade-11": "Grade 11",
  "grade-12": "Grade 12",
}

export function ReviewFinalizeStep({ data, onPrev, onComplete }: ReviewFinalizeStepProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [consentChecked, setConsentChecked] = useState(false)
  const [initial, setInitial] = useState("")

  const tuitionRate = data.grade ? TUITION_RATES[data.grade] : 0
  const discount = data.tuitionOption === "full" ? tuitionRate * 0.05 : 0
  const finalAmount = tuitionRate - discount

  const canSubmit = consentChecked && initial.trim().length > 0

  const handleSubmit = async () => {
    if (!canSubmit) return
    setIsSubmitting(true)
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 2000))
    setIsSubmitting(false)
    setIsComplete(true)
  }

  const handlePrint = () => {
    window.print()
  }

  if (isComplete) {
    return (
      <div className="space-y-6">
        <Card className="border-success bg-success/5">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="h-16 w-16 rounded-full bg-success/10 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-success" />
              </div>
              <div>
                <h2 className="text-2xl font-bold">Enrollment Submitted!</h2>
                <p className="text-muted-foreground mt-2">
                  Student enrollment has been successfully submitted for review
                </p>
              </div>
              <div className="flex gap-3 pt-4">
                <Button variant="outline" className="gap-2 bg-transparent">
                  <Download className="h-4 w-4" />
                  Download Summary
                </Button>
                <Button variant="outline" className="gap-2 bg-transparent">
                  <Printer className="h-4 w-4" />
                  Print Summary
                </Button>
              </div>
              <Button onClick={onComplete} size="lg" className="mt-4">
                Return to Dashboard
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Student Information */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle>Student Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-sm text-muted-foreground">Full Name</p>
              <p className="font-medium">
                {data.firstName} {data.middleName} {data.lastName}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Date of Birth</p>
              <p className="font-medium">{new Date(data.dateOfBirth).toLocaleDateString()}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Gender</p>
              <p className="font-medium capitalize">{data.gender}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Nationality</p>
              <p className="font-medium">{data.nationality}</p>
            </div>
            {data.nationalId && (
              <div>
                <p className="text-sm text-muted-foreground">National ID</p>
                <p className="font-medium">{data.nationalId}</p>
              </div>
            )}
            {data.bloodType && (
              <div>
                <p className="text-sm text-muted-foreground">Blood Type</p>
                <p className="font-medium">{data.bloodType}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Contact Information */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle>Contact Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-sm text-muted-foreground">Email</p>
              <p className="font-medium">{data.email}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Phone</p>
              <p className="font-medium">{data.phone}</p>
            </div>
          </div>

          <Separator />

          <div>
            <h4 className="font-semibold mb-3">Addresses</h4>
            {data.addresses.map((address, index) => (
              <div key={address.id} className="mb-3">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="capitalize">
                    {address.type}
                  </Badge>
                  {address.isPrimary && <Badge variant="secondary">Primary</Badge>}
                </div>
                <p className="text-sm">
                  {address.street}, {address.city}, {address.state} {address.postalCode}, {address.country}
                </p>
              </div>
            ))}
          </div>

          <Separator />

          <div>
            <h4 className="font-semibold mb-3">Parents / Guardians</h4>
            {data.parents.map((parent) => (
              <div key={parent.id} className="mb-4">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-medium">
                    {parent.firstName} {parent.lastName}
                  </p>
                  {parent.isPrimaryGuardian && <Badge variant="secondary">Primary Guardian</Badge>}
                  {parent.isEmergencyContact && <Badge variant="outline">Emergency Contact</Badge>}
                </div>
                <p className="text-sm text-muted-foreground capitalize">{parent.relationship}</p>
                <p className="text-sm">
                  {parent.email} • {parent.phone}
                </p>
                {parent.occupation && <p className="text-sm text-muted-foreground">Occupation: {parent.occupation}</p>}
                {!parent.sameAddressAsStudent && parent.addresses.length > 0 && (
                  <div className="mt-2 ml-4">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Parent Address:</p>
                    {parent.addresses.map((address) => (
                      <p key={address.id} className="text-xs">
                        {address.street}, {address.city}, {address.state} {address.postalCode}, {address.country}
                      </p>
                    ))}
                  </div>
                )}
                {parent.sameAddressAsStudent && (
                  <p className="text-xs text-muted-foreground mt-1">Same address as student</p>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Academic Information */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle>Academic Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-sm text-muted-foreground">Grade Level</p>
              <p className="font-medium">{GRADE_LABELS[data.grade]}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Enrollment Date</p>
              <p className="font-medium">{new Date(data.enrollmentDate).toLocaleDateString()}</p>
            </div>
          </div>
          {data.previousSchool && (
            <div>
              <p className="text-sm text-muted-foreground">Previous School</p>
              <p className="font-medium">{data.previousSchool}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tuition Summary */}
      <Card className="border-border bg-muted/30">
        <CardHeader>
          <CardTitle>Tuition Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Annual Tuition</span>
              <span className="font-medium">${tuitionRate.toLocaleString()}</span>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-success">
                <span>Full Payment Discount (5%)</span>
                <span>-${discount.toLocaleString()}</span>
              </div>
            )}
            <Separator />
            <div className="flex justify-between text-lg font-bold">
              <span>Total Amount Due</span>
              <span>${finalAmount.toLocaleString()}</span>
            </div>
          </div>

          <div className="bg-card rounded-lg p-4 border border-border">
            <p className="text-sm font-semibold mb-2">Payment Plan</p>
            <p className="text-sm text-muted-foreground">
              {data.tuitionOption === "full"
                ? `One-time payment of $${finalAmount.toLocaleString()}`
                : `10 monthly installments of $${(finalAmount / 10).toLocaleString()}`}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Consent and Verification */}
      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="pb-5 px-6 pt-6">
          <CardTitle className="text-lg font-semibold">Consent and Verification</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 px-6 pb-6">
          <div className="flex items-start space-x-3">
            <Checkbox
              id="consent"
              checked={consentChecked}
              onCheckedChange={setConsentChecked}
              className="mt-1"
            />
            <Label htmlFor="consent" className="text-sm font-medium cursor-pointer leading-relaxed">
              I confirm that all information provided is accurate and complete. I understand that providing false
              information may result in the rejection of this enrollment application.
            </Label>
          </div>

          <div className="space-y-2">
            <Label htmlFor="initial" className="text-sm font-medium">
              Initial <span className="text-destructive">*</span>
            </Label>
            <Input
              id="initial"
              value={initial}
              onChange={(e) => setInitial(e.target.value.toUpperCase())}
              placeholder="Enter your initial"
              className="h-10 max-w-[200px]"
              maxLength={10}
            />
            <p className="text-xs text-muted-foreground">Please enter your initial to confirm</p>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex justify-between pt-4 border-t border-border">
        <div className="flex gap-3">
          <Button onClick={handlePrint} variant="outline" size="lg" className="gap-2">
            <Printer className="h-4 w-4" />
            Print
          </Button>
          <Button onClick={onPrev} variant="outline" size="lg">
            Previous
          </Button>
        </div>
        <Button onClick={handleSubmit} disabled={isSubmitting || !canSubmit} size="lg" className="min-w-[200px]">
          {isSubmitting ? "Submitting..." : "Submit Enrollment"}
        </Button>
      </div>
    </div>
  )
}
