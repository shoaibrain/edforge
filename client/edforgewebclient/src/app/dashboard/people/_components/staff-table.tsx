"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import type { StaffProfileSummary } from "@/lib/schemas"
import {
  ArrowUpDown,
  Eye,
  MoreHorizontal,
  Mail,
  Phone,
  Users,
  GraduationCap,
  TrendingUp,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"

interface StaffTableProps {
  staff: StaffProfileSummary[]
}

type SortBy = "name" | "effectiveness" | "studentCount" | "hireDate" | "department"
type SortOrder = "asc" | "desc"

export function StaffTable({ staff }: StaffTableProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  
  const [sortBy, setSortBy] = useState<SortBy>(
    (searchParams.get("sortBy") as SortBy) || "name"
  )
  const [sortOrder, setSortOrder] = useState<SortOrder>(
    (searchParams.get("sortOrder") as SortOrder) || "asc"
  )

  // Filter and sort staff
  const filteredAndSortedStaff = useMemo(() => {
    const search = searchParams.get("search")?.toLowerCase() || ""
    const department = searchParams.get("department") || ""
    const role = searchParams.get("role") || ""
    const status = searchParams.get("status") || ""

    let filtered = staff.filter((member) => {
      const matchesSearch = !search || 
        member.firstName.toLowerCase().includes(search) ||
        member.lastName.toLowerCase().includes(search) ||
        member.employeeNumber.toLowerCase().includes(search) ||
        member.email.toLowerCase().includes(search)
      
      const matchesDepartment = !department || department === "all" || member.department === department
      const matchesRole = !role || role === "all" || member.roles.includes(role)
      const matchesStatus = !status || status === "all" || member.status === status
      
      return matchesSearch && matchesDepartment && matchesRole && matchesStatus
    })

    // Sort staff
    filtered.sort((a, b) => {
      let aValue: string | number
      let bValue: string | number

      switch (sortBy) {
        case "name":
          aValue = `${a.firstName} ${a.lastName}`
          bValue = `${b.firstName} ${b.lastName}`
          break
        case "effectiveness":
          aValue = a.effectivenessScore
          bValue = b.effectivenessScore
          break
        case "studentCount":
          aValue = a.studentCount
          bValue = b.studentCount
          break
        case "hireDate":
          aValue = new Date(a.hireDate).getTime()
          bValue = new Date(b.hireDate).getTime()
          break
        case "department":
          aValue = a.department
          bValue = b.department
          break
        default:
          aValue = `${a.firstName} ${a.lastName}`
          bValue = `${b.firstName} ${b.lastName}`
      }

      if (aValue < bValue) return sortOrder === "asc" ? -1 : 1
      if (aValue > bValue) return sortOrder === "asc" ? 1 : -1
      return 0
    })

    return filtered
  }, [staff, searchParams, sortBy, sortOrder])

  const handleSort = (column: SortBy) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc")
    } else {
      setSortBy(column)
      setSortOrder("asc")
    }
    const params = new URLSearchParams(searchParams.toString())
    params.set("sortBy", column)
    params.set("sortOrder", sortBy === column && sortOrder === "asc" ? "desc" : "asc")
    router.push(`?${params.toString()}`)
  }

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "active":
        return "default"
      case "on_leave":
        return "secondary"
      case "terminated":
        return "destructive"
      case "retired":
        return "outline"
      default:
        return "outline"
    }
  }

  const getEffectivenessColor = (score: number) => {
    if (score >= 90) return "text-success"
    if (score >= 80) return "text-info"
    if (score >= 70) return "text-warning"
    return "text-error"
  }

  if (filteredAndSortedStaff.length === 0) {
    return (
      <Card className="border-border bg-card">
        <CardContent className="p-12 text-center">
          <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-lg font-semibold text-foreground mb-2">No staff found</p>
          <p className="text-sm text-muted-foreground">
            Try adjusting your search or filter criteria
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-border bg-card shadow-md">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border">
                <TableHead className="w-[250px]">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-ml-3 h-8 data-[state=open]:bg-accent"
                    onClick={() => handleSort("name")}
                  >
                    Name
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
                <TableHead className="w-[150px]">Employee ID</TableHead>
                <TableHead className="w-[150px]">Department</TableHead>
                <TableHead className="w-[150px]">Role</TableHead>
                <TableHead className="w-[120px]">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-ml-3 h-8 data-[state=open]:bg-accent"
                    onClick={() => handleSort("effectiveness")}
                  >
                    Effectiveness
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
                <TableHead className="w-[120px]">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-ml-3 h-8 data-[state=open]:bg-accent"
                    onClick={() => handleSort("studentCount")}
                  >
                    Students
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
                <TableHead className="w-[120px]">Classes</TableHead>
                <TableHead className="w-[100px]">Status</TableHead>
                <TableHead className="w-[70px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAndSortedStaff.map((member) => (
                <TableRow key={member.staffId} className="border-b border-border/50 hover:bg-muted/50">
                  <TableCell>
                    <div className="flex flex-col">
                      <Link
                        href={`/dashboard/people/${member.staffId}`}
                        className="font-semibold text-foreground hover:text-primary transition-colors"
                      >
                        {member.firstName} {member.lastName}
                      </Link>
                      <div className="flex items-center gap-2 mt-1">
                        <Mail className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">{member.email}</span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-foreground">{member.employeeNumber}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {member.department}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <Badge variant="secondary" className="text-xs w-fit">
                        {member.primaryRole}
                      </Badge>
                      {member.roles.length > 1 && (
                        <span className="text-xs text-muted-foreground">
                          +{member.roles.length - 1} more
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {member.effectivenessScore > 0 ? (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-semibold ${getEffectivenessColor(member.effectivenessScore)}`}>
                            {member.effectivenessScore.toFixed(1)}%
                          </span>
                          {member.effectivenessScore >= 90 && (
                            <TrendingUp className="h-3 w-3 text-success" />
                          )}
                        </div>
                        <div className="h-1.5 w-20">
                          <Progress value={member.effectivenessScore} />
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">N/A</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium text-foreground">
                        {member.studentCount}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <GraduationCap className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium text-foreground">
                        {member.classesAssigned}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={getStatusBadgeVariant(member.status)} className="text-xs">
                      {member.status.charAt(0).toUpperCase() + member.status.slice(1).replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0">
                          <span className="sr-only">Open menu</span>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild>
                          <Link href={`/dashboard/people/${member.staffId}`}>
                            <Eye className="mr-2 h-4 w-4" />
                            View Profile
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                          <Mail className="mr-2 h-4 w-4" />
                          Send Email
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                          <Phone className="mr-2 h-4 w-4" />
                          Contact
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem>
                          Assign Classes
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                          View Analytics
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

