"use client"
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import type { EnrollmentFormData } from "../student-enrollment-form"

interface ContactDetailsStepProps {
  data: EnrollmentFormData
  updateData: (data: Partial<EnrollmentFormData>) => void
  onNext: () => void
  onPrev: () => void
}

export function ContactDetailsStep({ data, updateData, onNext, onPrev }: ContactDetailsStepProps) {
  // Validation: at least one address with required fields, at least one parent, email and phone
  const isValid =
    data.email &&
    data.phone &&
    data.addresses.length > 0 &&
    data.addresses[0].street &&
    data.addresses[0].city &&
    data.addresses[0].state &&
    data.addresses[0].postalCode &&
    data.addresses[0].country &&
    data.parents.length > 0

  const addAddress = () => {
    const newAddress = {
      id: Math.random().toString(36).substr(2, 9),
      type: "home" as const,
      street: "",
      city: "",
      state: "",
      postalCode: "",
      country: "",
      isPrimary: false,
    }
    updateData({ addresses: [...data.addresses, newAddress] })
  }

  const updateAddress = (id: string, updates: Partial<(typeof data.addresses)[0]>) => {
    updateData({
      addresses: data.addresses.map((addr) => (addr.id === id ? { ...addr, ...updates } : addr)),
    })
  }

  const removeAddress = (id: string) => {
    // Don't allow removing the first address
    if (data.addresses.length > 1) {
      updateData({
        addresses: data.addresses.filter((addr) => addr.id !== id),
      })
    }
  }

  const addParent = () => {
    const newParent = {
      id: Math.random().toString(36).substr(2, 9),
      firstName: "",
      lastName: "",
      relationship: "",
      email: "",
      phone: "",
      isPrimaryGuardian: data.parents.length === 0,
      isEmergencyContact: false,
      sameAddressAsStudent: true,
      addresses: [],
    }
    updateData({ parents: [...data.parents, newParent] })
  }

  const updateParent = (id: string, updates: Partial<(typeof data.parents)[0]>) => {
    updateData({
      parents: data.parents.map((parent) => (parent.id === id ? { ...parent, ...updates } : parent)),
    })
  }

  const removeParent = (id: string) => {
    updateData({
      parents: data.parents.filter((parent) => parent.id !== id),
    })
  }

  const addParentAddress = (parentId: string) => {
    const parent = data.parents.find((p) => p.id === parentId)
    if (!parent) return

    const newAddress = {
      id: Math.random().toString(36).substr(2, 9),
      type: "home" as const,
      street: "",
      city: "",
      state: "",
      postalCode: "",
      country: "",
      isPrimary: parent.addresses.length === 0,
    }

    updateParent(parentId, {
      addresses: [...parent.addresses, newAddress],
    })
  }

  const updateParentAddress = (parentId: string, addressId: string, updates: Partial<(typeof data.parents)[0]["addresses"][0]>) => {
    const parent = data.parents.find((p) => p.id === parentId)
    if (!parent) return

    updateParent(parentId, {
      addresses: parent.addresses.map((addr) => (addr.id === addressId ? { ...addr, ...updates } : addr)),
    })
  }

  const removeParentAddress = (parentId: string, addressId: string) => {
    const parent = data.parents.find((p) => p.id === parentId)
    if (!parent) return

    updateParent(parentId, {
      addresses: parent.addresses.filter((addr) => addr.id !== addressId),
    })
  }

  return (
    <div className="space-y-6">
      {/* Student Contact */}
      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="pb-5 px-6 pt-6">
          <CardTitle className="text-lg font-semibold">Student Contact Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 px-6 pb-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium">
                Email <span className="text-destructive">*</span>
              </Label>
              <Input
                id="email"
                type="email"
                value={data.email}
                onChange={(e) => updateData({ email: e.target.value })}
                placeholder="student@example.com"
                className="h-10"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone" className="text-sm font-medium">
                Phone <span className="text-destructive">*</span>
              </Label>
              <Input
                id="phone"
                type="tel"
                value={data.phone}
                onChange={(e) => updateData({ phone: e.target.value })}
                placeholder="+1 (555) 000-0000"
                className="h-10"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Addresses - First address is always rendered */}
      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="pb-5 px-6 pt-6">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold">Addresses</CardTitle>
            <Button onClick={addAddress} size="sm" variant="outline" className="gap-2">
              <Plus className="h-4 w-4" />
              Add Address
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 px-6 pb-6">
          {data.addresses.map((address, index) => (
            <div key={address.id}>
              {index > 0 && <Separator className="my-6" />}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold">
                    {index === 0 ? "Primary Address" : `Address ${index + 1}`}
                  </h4>
                  {data.addresses.length > 1 && (
                    <Button variant="ghost" size="sm" onClick={() => removeAddress(address.id)} className="text-destructive hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Type</Label>
                    <Select
                      value={address.type}
                      onValueChange={(value: "home" | "mailing") => updateAddress(address.id, { type: value })}
                    >
                      <SelectTrigger className="h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="home">Home</SelectItem>
                        <SelectItem value="mailing">Mailing</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center space-x-2 pt-8">
                    <Switch
                      checked={address.isPrimary}
                      onCheckedChange={(checked: boolean) => updateAddress(address.id, { isPrimary: checked })}
                      disabled={index === 0}
                    />
                    <Label className="text-sm font-medium">Primary Address</Label>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">
                    Street Address <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    value={address.street}
                    onChange={(e) => updateAddress(address.id, { street: e.target.value })}
                    placeholder="123 Main Street"
                    className="h-10"
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">
                      City <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      value={address.city}
                      onChange={(e) => updateAddress(address.id, { city: e.target.value })}
                      placeholder="City"
                      className="h-10"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">
                      State/Province <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      value={address.state}
                      onChange={(e) => updateAddress(address.id, { state: e.target.value })}
                      placeholder="State"
                      className="h-10"
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">
                      Postal Code <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      value={address.postalCode}
                      onChange={(e) => updateAddress(address.id, { postalCode: e.target.value })}
                      placeholder="12345"
                      className="h-10"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">
                      Country <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      value={address.country}
                      onChange={(e) => updateAddress(address.id, { country: e.target.value })}
                      placeholder="Country"
                      className="h-10"
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Parents/Guardians */}
      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="pb-5 px-6 pt-6">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold">Parents / Guardians</CardTitle>
            <Button onClick={addParent} size="sm" variant="outline" className="gap-2">
              <Plus className="h-4 w-4" />
              Add Parent
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 px-6 pb-6">
          {data.parents.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No parents/guardians added yet</p>
          ) : (
            data.parents.map((parent, index) => (
              <div key={parent.id}>
                {index > 0 && <Separator className="my-6" />}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold">Parent/Guardian {index + 1}</h4>
                    {data.parents.length > 1 && (
                      <Button variant="ghost" size="sm" onClick={() => removeParent(parent.id)} className="text-destructive hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="flex items-center space-x-2">
                      <Switch
                        checked={parent.isPrimaryGuardian}
                        onCheckedChange={(checked: boolean) => updateParent(parent.id, { isPrimaryGuardian: checked })}
                      />
                      <Label className="text-sm font-medium">Primary Guardian (Responsible for fees)</Label>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Switch
                        checked={parent.isEmergencyContact}
                        onCheckedChange={(checked: boolean) => updateParent(parent.id, { isEmergencyContact: checked })}
                      />
                      <Label className="text-sm font-medium">Emergency Contact</Label>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">First Name</Label>
                      <Input
                        value={parent.firstName}
                        onChange={(e) => updateParent(parent.id, { firstName: e.target.value })}
                        placeholder="First name"
                        className="h-10"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Last Name</Label>
                      <Input
                        value={parent.lastName}
                        onChange={(e) => updateParent(parent.id, { lastName: e.target.value })}
                        placeholder="Last name"
                        className="h-10"
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Relationship</Label>
                      <Select
                        value={parent.relationship}
                        onValueChange={(value: string) => updateParent(parent.id, { relationship: value })}
                      >
                        <SelectTrigger className="h-10">
                          <SelectValue placeholder="Select relationship" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="mother">Mother</SelectItem>
                          <SelectItem value="father">Father</SelectItem>
                          <SelectItem value="guardian">Guardian</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Occupation</Label>
                      <Input
                        value={parent.occupation || ""}
                        onChange={(e) => updateParent(parent.id, { occupation: e.target.value })}
                        placeholder="Occupation"
                        className="h-10"
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Email</Label>
                      <Input
                        type="email"
                        value={parent.email}
                        onChange={(e) => updateParent(parent.id, { email: e.target.value })}
                        placeholder="parent@example.com"
                        className="h-10"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Phone</Label>
                      <Input
                        type="tel"
                        value={parent.phone}
                        onChange={(e) => updateParent(parent.id, { phone: e.target.value })}
                        placeholder="+1 (555) 000-0000"
                        className="h-10"
                      />
                    </div>
                  </div>

                  {/* Same Address as Student Checkbox */}
                  <div className="flex items-center space-x-2 pt-2">
                    <Checkbox
                      id={`same-address-${parent.id}`}
                      checked={parent.sameAddressAsStudent}
                      onCheckedChange={(checked) => updateParent(parent.id, { sameAddressAsStudent: checked as boolean })}
                    />
                    <Label htmlFor={`same-address-${parent.id}`} className="text-sm font-medium cursor-pointer">
                      Same address as student
                    </Label>
                  </div>

                  {/* Parent Address Fields - Only show if "Same address as student" is unchecked */}
                  {!parent.sameAddressAsStudent && (
                    <div className="space-y-4 pt-4 border-t border-border">
                      <div className="flex items-center justify-between">
                        <h5 className="text-sm font-semibold">Parent Address</h5>
                        <Button onClick={() => addParentAddress(parent.id)} size="sm" variant="outline" className="gap-2">
                          <Plus className="h-4 w-4" />
                          Add Address
                        </Button>
                      </div>

                      {parent.addresses.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No address added. Click "Add Address" to add one.</p>
                      ) : (
                        parent.addresses.map((address, addrIndex) => (
                          <div key={address.id} className="space-y-4">
                            {addrIndex > 0 && <Separator className="my-4" />}
                            <div className="flex items-center justify-between">
                              <h6 className="text-xs font-medium text-muted-foreground">
                                {addrIndex === 0 ? "Primary Address" : `Address ${addrIndex + 1}`}
                              </h6>
                              {parent.addresses.length > 1 && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeParentAddress(parent.id, address.id)}
                                  className="text-destructive hover:text-destructive h-8"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              )}
                            </div>

                            <div className="grid gap-4 md:grid-cols-2">
                              <div className="space-y-2">
                                <Label className="text-sm font-medium">Type</Label>
                                <Select
                                  value={address.type}
                                  onValueChange={(value: "home" | "mailing") =>
                                    updateParentAddress(parent.id, address.id, { type: value })
                                  }
                                >
                                  <SelectTrigger className="h-10">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="home">Home</SelectItem>
                                    <SelectItem value="mailing">Mailing</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>

                              <div className="flex items-center space-x-2 pt-8">
                                <Switch
                                  checked={address.isPrimary}
                                  onCheckedChange={(checked: boolean) => updateParentAddress(parent.id, address.id, { isPrimary: checked })}
                                  disabled={addrIndex === 0}
                                />
                                <Label className="text-sm font-medium">Primary</Label>
                              </div>
                            </div>

                            <div className="space-y-2">
                              <Label className="text-sm font-medium">Street Address</Label>
                              <Input
                                value={address.street}
                                onChange={(e) => updateParentAddress(parent.id, address.id, { street: e.target.value })}
                                placeholder="123 Main Street"
                                className="h-10"
                              />
                            </div>

                            <div className="grid gap-4 md:grid-cols-2">
                              <div className="space-y-2">
                                <Label className="text-sm font-medium">City</Label>
                                <Input
                                  value={address.city}
                                  onChange={(e) => updateParentAddress(parent.id, address.id, { city: e.target.value })}
                                  placeholder="City"
                                  className="h-10"
                                />
                              </div>

                              <div className="space-y-2">
                                <Label className="text-sm font-medium">State/Province</Label>
                                <Input
                                  value={address.state}
                                  onChange={(e) => updateParentAddress(parent.id, address.id, { state: e.target.value })}
                                  placeholder="State"
                                  className="h-10"
                                />
                              </div>
                            </div>

                            <div className="grid gap-4 md:grid-cols-2">
                              <div className="space-y-2">
                                <Label className="text-sm font-medium">Postal Code</Label>
                                <Input
                                  value={address.postalCode}
                                  onChange={(e) => updateParentAddress(parent.id, address.id, { postalCode: e.target.value })}
                                  placeholder="12345"
                                  className="h-10"
                                />
                              </div>

                              <div className="space-y-2">
                                <Label className="text-sm font-medium">Country</Label>
                                <Input
                                  value={address.country}
                                  onChange={(e) => updateParentAddress(parent.id, address.id, { country: e.target.value })}
                                  placeholder="Country"
                                  className="h-10"
                                />
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex justify-between pt-4 border-t border-border">
        <Button onClick={onPrev} variant="outline" size="lg">
          Previous
        </Button>
        <Button onClick={onNext} disabled={!isValid} size="lg" className="min-w-[140px]">
          Next Step
        </Button>
      </div>
    </div>
  )
}
