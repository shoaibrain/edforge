"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Separator } from "@/components/ui/separator"
import type { EnrollmentFormData } from "../student-enrollment-form"

interface AcademicsStepProps {
  data: EnrollmentFormData
  updateData: (data: Partial<EnrollmentFormData>) => void
  onNext: () => void
  onPrev: () => void
}

// Dummy tuition data
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

export function AcademicsStep({ data, updateData, onNext, onPrev }: AcademicsStepProps) {
  const isValid = data.grade && data.enrollmentDate

  const tuitionRate = data.grade ? TUITION_RATES[data.grade] : 0
  const installmentAmount = tuitionRate / 10 // 10 monthly installments

  return (
    <div className="space-y-6">
      {/* Academic Information */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle>Academic Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="grade">
                Grade Level <span className="text-destructive">*</span>
              </Label>
              <Select value={data.grade} onValueChange={(value: string) => updateData({ grade: value })}>
                <SelectTrigger id="grade">
                  <SelectValue placeholder="Select grade" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="grade-k">Kindergarten</SelectItem>
                  <SelectItem value="grade-1">Grade 1</SelectItem>
                  <SelectItem value="grade-2">Grade 2</SelectItem>
                  <SelectItem value="grade-3">Grade 3</SelectItem>
                  <SelectItem value="grade-4">Grade 4</SelectItem>
                  <SelectItem value="grade-5">Grade 5</SelectItem>
                  <SelectItem value="grade-6">Grade 6</SelectItem>
                  <SelectItem value="grade-7">Grade 7</SelectItem>
                  <SelectItem value="grade-8">Grade 8</SelectItem>
                  <SelectItem value="grade-9">Grade 9</SelectItem>
                  <SelectItem value="grade-10">Grade 10</SelectItem>
                  <SelectItem value="grade-11">Grade 11</SelectItem>
                  <SelectItem value="grade-12">Grade 12</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="enrollmentDate">
                Enrollment Date <span className="text-destructive">*</span>
              </Label>
              <Input
                id="enrollmentDate"
                type="date"
                value={data.enrollmentDate}
                onChange={(e) => updateData({ enrollmentDate: e.target.value })}
              />
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <h4 className="text-sm font-semibold">Previous School (Optional)</h4>
            <div className="space-y-2">
              <Label htmlFor="previousSchool">School Name</Label>
              <Input
                id="previousSchool"
                value={data.previousSchool || ""}
                onChange={(e) => updateData({ previousSchool: e.target.value })}
                placeholder="Previous school name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="previousSchoolAddress">School Address</Label>
              <Input
                id="previousSchoolAddress"
                value={data.previousSchoolAddress || ""}
                onChange={(e) => updateData({ previousSchoolAddress: e.target.value })}
                placeholder="Previous school address"
              />
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <h4 className="text-sm font-semibold">Special Considerations (Optional)</h4>
            <div className="space-y-2">
              <Label htmlFor="specialNeeds">Special Needs / IEP</Label>
              <Textarea
                id="specialNeeds"
                value={data.specialNeeds || ""}
                onChange={(e) => updateData({ specialNeeds: e.target.value })}
                placeholder="Describe any special educational needs..."
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="medicalConditions">Medical Conditions</Label>
              <Textarea
                id="medicalConditions"
                value={data.medicalConditions || ""}
                onChange={(e) => updateData({ medicalConditions: e.target.value })}
                placeholder="Describe any medical conditions or allergies..."
                rows={3}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tuition & Payment */}
      {data.grade && (
        <Card className="border-border bg-muted/30">
          <CardHeader>
            <CardTitle>Tuition & Payment Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted-foreground">Annual Tuition</span>
                <span className="text-2xl font-bold">${tuitionRate.toLocaleString()}</span>
              </div>

              <Separator />

              <div className="space-y-3">
                <Label>Payment Option</Label>
                <RadioGroup
                  value={data.tuitionOption}
                  onValueChange={(value: "full" | "installment") =>
                    updateData({
                      tuitionOption: value as "full" | "installment",
                    })
                  }
                >
                  <div className="flex items-center space-x-3 rounded-lg border border-border p-4 hover:border-primary/50 transition-colors">
                    <RadioGroupItem value="full" id="payment-full" />
                    <Label htmlFor="payment-full" className="flex-1 cursor-pointer">
                      <div className="font-semibold">Pay in Full</div>
                      <div className="text-sm text-muted-foreground">
                        One-time payment of ${tuitionRate.toLocaleString()}
                      </div>
                      <div className="text-sm text-success font-medium mt-1">
                        Save 5% (${(tuitionRate * 0.05).toLocaleString()})
                      </div>
                    </Label>
                  </div>

                  <div className="flex items-center space-x-3 rounded-lg border border-border p-4 hover:border-primary/50 transition-colors">
                    <RadioGroupItem value="installment" id="payment-installment" />
                    <Label htmlFor="payment-installment" className="flex-1 cursor-pointer">
                      <div className="font-semibold">Monthly Installments</div>
                      <div className="text-sm text-muted-foreground">
                        10 monthly payments of ${installmentAmount.toLocaleString()}
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">September through June</div>
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-4 mt-4">
                <p className="text-sm text-foreground">
                  <span className="font-semibold">Note:</span> Tuition includes books, materials, and access to all
                  school facilities. Additional fees may apply for extracurricular activities.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-between">
        <Button onClick={onPrev} variant="outline" size="lg">
          Previous
        </Button>
        <Button onClick={onNext} disabled={!isValid} size="lg">
          Review & Finalize
        </Button>
      </div>
    </div>
  )
}
