"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card, CardContent } from "@/components/ui/card"
import { Search, X } from "lucide-react"

interface StaffFiltersProps {
  departments: string[]
  roles: string[]
  statuses: string[]
}

export function StaffFilters({ departments, roles, statuses }: StaffFiltersProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const search = searchParams.get("search") || ""
  const department = searchParams.get("department") || undefined
  const role = searchParams.get("role") || undefined
  const status = searchParams.get("status") || undefined

  const updateSearchParams = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value && value !== "all") {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    router.push(`?${params.toString()}`)
  }

  const clearFilters = () => {
    router.push("?")
  }

  const hasActiveFilters = search || (department && department !== "all") || (role && role !== "all") || (status && status !== "all")

  return (
    <Card className="border-border bg-card">
      <CardContent className="p-4">
        <div className="flex flex-col md:flex-row gap-4 items-end">
          <div className="flex-1 w-full md:w-auto">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, employee ID, or email..."
                value={search}
                onChange={(e) => updateSearchParams("search", e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          <Select value={department || "all"} onValueChange={(value: string) => updateSearchParams("department", value)}>
            <SelectTrigger className="w-full md:w-[180px]">
              <SelectValue placeholder="Department" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {departments.map((dept) => (
                <SelectItem key={dept} value={dept}>
                  {dept}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={role || "all"} onValueChange={(value: string) => updateSearchParams("role", value)}>
            <SelectTrigger className="w-full md:w-[180px]">
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              {roles.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={status || "all"} onValueChange={(value: string) => updateSearchParams("status", value)}>
            <SelectTrigger className="w-full md:w-[180px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {statuses.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1).replace('_', ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasActiveFilters && (
            <Button
              variant="outline"
              size="sm"
              onClick={clearFilters}
              className="w-full md:w-auto"
            >
              <X className="h-4 w-4 mr-2" />
              Clear
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

