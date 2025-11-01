"use client"

import { useCreateTenant } from "@/services/tenant-service"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, CheckCircle2, ArrowLeft, Building, Users, Zap, Mail } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, useCallback } from "react"
import { useSession } from "next-auth/react"
import { v4 as uuid } from "uuid"
import { PRICING_PLANS } from "@/constants/pricing"
import { TENANT_DEFAULTS, TENANT_VALIDATION } from "@/constants/tenant"
import type { CreateTenantRequest } from "@/types/tenant"

interface FormData {
  tenantName: string
  email: string
  tier: string
  useFederation: boolean
  useEc2: boolean
  useRProxy: boolean
}

export function CreateTenantForm() {
  const router = useRouter()
  const { data: session } = useSession()
  const createMutation = useCreateTenant()
  const [formData, setFormData] = useState<FormData>({
    tenantName: "",
    email: "",
    tier: "ADVANCED",
    useFederation: false,
    useEc2: false,
    useRProxy: true,
  })
  const [validationErrors, setValidationErrors] = useState<{
    [key: string]: string
  }>({})

  // Validation functions
  const validateTenantName = (name: string): string | null => {
    if (!name) return "Tenant name is required"
    if (!TENANT_VALIDATION.NAME_REGEX.test(name)) {
      return "Must start with a lowercase letter, and only contain lowercase letters, numbers, and hyphens"
    }
    return null
  }

  const validateEmail = (email: string): string | null => {
    if (!email) return "Email is required"
    if (!TENANT_VALIDATION.EMAIL_REGEX.test(email)) return "Please enter a valid email address"
    return null
  }

  const handleChange = useCallback(
    (field: keyof FormData) =>
      (
        event:
          | React.ChangeEvent<HTMLInputElement>
          | { target: { value: string; checked?: boolean } }
      ) => {
        const value =
          field === "useFederation" ||
          field === "useEc2" ||
          field === "useRProxy"
            ? event.target.checked
            : event.target.value

        setFormData((prev) => ({
          ...prev,
          [field]: value,
        }))

        // Clear validation error when user starts typing
        if (validationErrors[field]) {
          setValidationErrors((prev) => ({
            ...prev,
            [field]: "",
          }))
        }

        // Handle federation and EC2 control based on tier
        if (field === "tier") {
          if (value !== "ADVANCED" && value !== "PREMIUM") {
            setFormData((prev) => ({
              ...prev,
              useFederation: false,
            }))
          }
          if (value !== "PREMIUM") {
            setFormData((prev) => ({
              ...prev,
              useEc2: false,
            }))
          }
        }
      },
    [validationErrors]
  )

  const validateForm = useCallback((): boolean => {
    const errors: { [key: string]: string } = {}

    const tenantNameError = validateTenantName(formData.tenantName)
    if (tenantNameError) errors.tenantName = tenantNameError

    const emailError = validateEmail(formData.email)
    if (emailError) errors.email = emailError

    if (!formData.tier) errors.tier = "Tier is required"

    setValidationErrors(errors)
    return Object.keys(errors).length === 0
  }, [formData.tenantName, formData.email, formData.tier])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Add authentication check
    if (!session?.user) {
      console.error('[TENANT] Authentication required')
      return
    }

    if (!validateForm()) {
      return
    }

    try {
      const tenant: CreateTenantRequest = {
        tenantId: uuid(),
        tenantData: {
          tenantName: formData.tenantName,
          email: formData.email,
          tier: formData.tier,
          prices: [],
          useFederation: String(formData.useFederation),
          useEc2: String(formData.useEc2),
          useRProxy: String(formData.useRProxy),
        },
        tenantRegistrationData: {
          registrationStatus: TENANT_DEFAULTS.REGISTRATION_STATUS,
        },
      }

      if (process.env.NODE_ENV === 'development') {
        console.log('[TENANT] Creating tenant with data:', tenant)
      }

      await createMutation.mutateAsync(tenant)
      // Success - redirect to tenants list
      router.push("/tenants")
    } catch (error) {
      console.error('[TENANT] Create tenant error:', error)
      // Error is handled by mutation
    }
  }

  return (
    <div className="min-h-screen bg-muted/40">
      <div className="container mx-auto p-6">
        {/* Header with Back Button */}
        <Button
          variant="ghost"
          onClick={() => router.back()}
          className="mb-6"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Tenants
        </Button>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Main Form */}
          <div className="lg:col-span-3">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building className="h-5 w-5" />
                  Onboard New Tenant
                </CardTitle>
                <CardDescription>
                  Set up a new tenant organization with automated infrastructure provisioning
                </CardDescription>
              </CardHeader>
              <CardContent>
                {createMutation.error && (
                  <Alert variant="destructive" className="mb-6">
                    <AlertDescription>
                      {createMutation.error instanceof Error
                        ? createMutation.error.message
                        : "Failed to create tenant"}
                    </AlertDescription>
                  </Alert>
                )}

                {createMutation.isSuccess && (
                  <Alert className="mb-6">
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertDescription>
                      Tenant created successfully! Redirecting...
                    </AlertDescription>
                  </Alert>
                )}

                <form onSubmit={handleSubmit} className="space-y-6">
                  {/* Tenant Name */}
                  <div className="space-y-2">
                    <Label htmlFor="tenantName">
                      Tenant Name <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="tenantName"
                      value={formData.tenantName}
                      onChange={handleChange("tenantName")}
                      placeholder="Enter tenant name"
                      className={validationErrors.tenantName ? "border-red-500" : ""}
                      required
                    />
                    {validationErrors.tenantName && (
                      <p className="text-sm text-red-500">{validationErrors.tenantName}</p>
                    )}
                  </div>

                  {/* Administrator Email */}
                  <div className="space-y-2">
                    <Label htmlFor="email">
                      Administrator Email <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      onChange={handleChange("email")}
                      placeholder="admin@company.com"
                      className={validationErrors.email ? "border-red-500" : ""}
                      required
                    />
                    {validationErrors.email && (
                      <p className="text-sm text-red-500">{validationErrors.email}</p>
                    )}
                  </div>

                  {/* Tier Selection */}
                  <div className="space-y-2">
                    <Label>
                      Tier <span className="text-red-500">*</span>
                    </Label>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {Object.values(PRICING_PLANS).map((plan) => (
                        <Card
                          key={plan.id}
                          className={`cursor-pointer transition-all hover:shadow-md ${
                            formData.tier === plan.id
                              ? "ring-2 ring-blue-500 border-blue-500"
                              : "hover:border-gray-300"
                          }`}
                          onClick={() =>
                            handleChange("tier")({
                              target: { value: plan.id },
                            })
                          }
                        >
                          <CardContent className="p-4">
                            <div className="text-center">
                              <h3 className="font-semibold">{plan.name}</h3>
                              <p className="text-2xl font-bold text-blue-600">
                                ${plan.price}/month
                              </p>
                              <p className="text-sm text-muted-foreground mt-2">
                                {plan.description}
                              </p>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                    {validationErrors.tier && (
                      <p className="text-sm text-red-500">{validationErrors.tier}</p>
                    )}
                  </div>

                  {/* Configuration Options */}
                  <div className="space-y-4">
                    <Label>Configuration Options</Label>
                    
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <Label htmlFor="useFederation">Use Federation</Label>
                          <p className="text-sm text-muted-foreground">
                            {formData.tier !== "ADVANCED" && formData.tier !== "PREMIUM"
                              ? "Advanced/Premium only"
                              : "Enable SSO integration"}
                          </p>
                        </div>
                        <input
                          id="useFederation"
                          type="checkbox"
                          checked={formData.useFederation}
                          onChange={handleChange("useFederation")}
                          disabled={
                            formData.tier !== "ADVANCED" && formData.tier !== "PREMIUM"
                          }
                          className="h-4 w-4"
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <div>
                          <Label htmlFor="useRProxy">Use Reverse Proxy</Label>
                          <p className="text-sm text-muted-foreground">
                            Enable request routing proxy
                          </p>
                        </div>
                        <input
                          id="useRProxy"
                          type="checkbox"
                          checked={formData.useRProxy}
                          onChange={handleChange("useRProxy")}
                          disabled={formData.tier === "BASIC"}
                          className="h-4 w-4"
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <div>
                          <Label htmlFor="useEc2">Use EC2</Label>
                          <p className="text-sm text-muted-foreground">
                            Use EC2 instead of Fargate
                          </p>
                        </div>
                        <input
                          id="useEc2"
                          type="checkbox"
                          checked={formData.useEc2}
                          onChange={handleChange("useEc2")}
                          disabled={formData.tier !== "PREMIUM"}
                          className="h-4 w-4"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Submit Button */}
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={createMutation.isPending}
                  >
                    {createMutation.isPending && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    {createMutation.isPending ? "Creating Tenant..." : "Create Tenant"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="lg:col-span-1">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building className="h-5 w-5" />
                  Tenant Preview
                </CardTitle>
                <CardDescription>
                  Review the tenant information to be created
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-blue-500" />
                    <span className="text-sm">User Management</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-blue-500" />
                    <span className="text-sm">Auto Provisioning</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-blue-500" />
                    <span className="text-sm">Administrator Invitation</span>
                  </div>
                </div>

                <div className="pt-4 border-t">
                  <p className="text-sm text-muted-foreground mb-2">
                    The following resources will be automatically provisioned after tenant creation:
                  </p>
                  <ul className="text-sm space-y-1">
                    <li>• DynamoDB Tables</li>
                    <li>• Cognito User Pool</li>
                    <li>• Tenant Service Setting</li>
                    <li>• Tenant Routing Configuration</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

