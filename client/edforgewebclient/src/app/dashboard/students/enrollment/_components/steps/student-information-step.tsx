"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { EnrollmentFormData } from "../student-enrollment-form"

interface StudentInformationStepProps {
  data: EnrollmentFormData
  updateData: (data: Partial<EnrollmentFormData>) => void
  onNext: () => void
}

export function StudentInformationStep({ data, updateData, onNext }: StudentInformationStepProps) {
  const isValid = data.firstName && data.lastName && data.dateOfBirth && data.gender && data.nationality

  return (
    <div className="space-y-6">
      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="pb-5 px-6 pt-6">
          <CardTitle className="text-lg font-semibold">Personal Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 px-6 pb-6">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="firstName" className="text-sm font-medium">
                First Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="firstName"
                value={data.firstName}
                onChange={(e) => updateData({ firstName: e.target.value })}
                placeholder="Enter first name"
                className="h-10"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="middleName" className="text-sm font-medium">Middle Name</Label>
              <Input
                id="middleName"
                value={data.middleName || ""}
                onChange={(e) => updateData({ middleName: e.target.value })}
                placeholder="Enter middle name"
                className="h-10"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="lastName" className="text-sm font-medium">
                Last Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="lastName"
                value={data.lastName}
                onChange={(e) => updateData({ lastName: e.target.value })}
                placeholder="Enter last name"
                className="h-10"
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="dateOfBirth" className="text-sm font-medium">
                Date of Birth <span className="text-destructive">*</span>
              </Label>
              <Input
                id="dateOfBirth"
                type="date"
                value={data.dateOfBirth}
                onChange={(e) => updateData({ dateOfBirth: e.target.value })}
                className="h-10"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="gender" className="text-sm font-medium">
                Gender <span className="text-destructive">*</span>
              </Label>
              <Select value={data.gender} onValueChange={(value: "male" | "female" | "other") => updateData({ gender: value })}>
                <SelectTrigger id="gender" className="h-10">
                  <SelectValue placeholder="Select gender" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="nationality" className="text-sm font-medium">
                Nationality <span className="text-destructive">*</span>
              </Label>
              <Input
                id="nationality"
                value={data.nationality}
                onChange={(e) => updateData({ nationality: e.target.value })}
                placeholder="Enter nationality"
                className="h-10"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="nationalId" className="text-sm font-medium">National ID</Label>
              <Input
                id="nationalId"
                value={data.nationalId || ""}
                onChange={(e) => updateData({ nationalId: e.target.value })}
                placeholder="Enter national ID"
                className="h-10"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bloodType" className="text-sm font-medium">Blood Type</Label>
              <Select value={data.bloodType || ""} onValueChange={(value: string) => updateData({ bloodType: value })}>
                <SelectTrigger id="bloodType" className="h-10">
                  <SelectValue placeholder="Select blood type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="A+">A+</SelectItem>
                  <SelectItem value="A-">A-</SelectItem>
                  <SelectItem value="B+">B+</SelectItem>
                  <SelectItem value="B-">B-</SelectItem>
                  <SelectItem value="AB+">AB+</SelectItem>
                  <SelectItem value="AB-">AB-</SelectItem>
                  <SelectItem value="O+">O+</SelectItem>
                  <SelectItem value="O-">O-</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex justify-end pt-4 border-t border-border">
        <Button onClick={onNext} disabled={!isValid} size="lg" className="min-w-[140px]">
          Next Step
        </Button>
      </div>
    </div>
  )
}
