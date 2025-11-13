"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  GraduationCap,
  Users,
  TrendingUp,
  BookOpen,
  Calendar,
  Award,
  Mail,
  Phone,
  Edit,
  FileText,
  BarChart3,
} from "lucide-react"
import { TSDLDashboard } from "./tsdl-dashboard"
import { QualificationsSection } from "./qualifications-section"
import { AssignmentsSection } from "./assignments-section"
import { ComprehensivePerformanceAnalytics } from "./comprehensive-performance-analytics"

interface StaffProfileDetailProps {
  data: {
    staffId: string
    employeeNumber: string
    firstName: string
    lastName: string
    middleName?: string
    email: string
    phone: string
    department: string
    primaryRole: string
    roles: string[]
    status: 'active' | 'on_leave' | 'terminated' | 'retired'
    hireDate: string
    classesAssigned: number
    studentCount: number
    effectivenessScore: number
    yearsOfService: number
    attendanceRate: number
    qualifications: any
    assignments: any[]
    tsdlData: any
    performanceMetrics: any
    resultsMetrics: any
    professionalDevelopment: any[]
    incentives: any[]
  }
}

export function StaffProfileDetail({ data }: StaffProfileDetailProps) {
  const fullName = `${data.firstName} ${data.middleName ? data.middleName + ' ' : ''}${data.lastName}`
  const initials = `${data.firstName[0]}${data.lastName[0]}`

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="relative">
            <Avatar className="h-20 w-20 ring-4 ring-primary/20">
              <AvatarImage
                src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${data.staffId}`}
                alt={fullName}
              />
              <AvatarFallback className="text-xl font-bold bg-gradient-to-br from-primary to-primary/80 text-primary-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className={`absolute -bottom-1 -right-1 h-6 w-6 rounded-full border-2 border-background ${
              data.status === 'active' ? 'bg-success' : 
              data.status === 'on_leave' ? 'bg-warning' : 
              'bg-muted'
            }`} />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              {fullName}
            </h1>
            <p className="text-muted-foreground mt-1">
              {data.employeeNumber} • {data.department}
            </p>
            <div className="flex items-center gap-2 mt-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{data.email}</span>
              <Phone className="h-4 w-4 text-muted-foreground ml-4" />
              <span className="text-sm text-muted-foreground">{data.phone}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="default" className="text-sm px-3 py-1">
            {data.primaryRole}
          </Badge>
          <Button variant="outline" size="sm">
            <Edit className="h-4 w-4 mr-2" />
            Edit
          </Button>
          <Button variant="outline" size="sm">
            <FileText className="h-4 w-4 mr-2" />
            Reports
          </Button>
        </div>
      </div>


      {/* Key Metrics - Enhanced with Trends */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-card border-l-4 border-l-secondary shadow-md hover:shadow-lg transition-all duration-200 relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-secondary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <CardContent className="p-4 relative">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-muted-foreground mb-1">Class Assignments</p>
                <p className="text-xl font-bold text-secondary mb-1">{data.classesAssigned}</p>
                <p className="text-xs text-muted-foreground/70">{data.studentCount} students</p>
              </div>
              <BookOpen className="h-5 w-5 text-secondary/60 flex-shrink-0" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-l-4 border-l-success shadow-md hover:shadow-lg transition-all duration-200 relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-success/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <CardContent className="p-4 relative">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-muted-foreground mb-1">Attendance Rate</p>
                <div className="flex items-center gap-1 mb-1">
                  <p className="text-xl font-bold text-success">{data.attendanceRate}%</p>
                  <TrendingUp className="h-3 w-3 text-success" />
                </div>
                <p className="text-xs text-success flex items-center gap-1">
                  <span>Above average</span>
                </p>
              </div>
              <Calendar className="h-5 w-5 text-success/60 flex-shrink-0" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-l-4 border-l-warning shadow-md hover:shadow-lg transition-all duration-200 relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-warning/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <CardContent className="p-4 relative">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-muted-foreground mb-1">Years of Service</p>
                <p className="text-xl font-bold text-warning mb-1">{data.yearsOfService}</p>
                <p className="text-xs text-muted-foreground/70">Since {new Date(data.hireDate).getFullYear()}</p>
              </div>
              <GraduationCap className="h-5 w-5 text-warning/60 flex-shrink-0" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-l-4 border-l-primary shadow-md hover:shadow-lg transition-all duration-200 relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <CardContent className="p-4 relative">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-muted-foreground mb-1">Effectiveness</p>
                <div className="flex items-center gap-1 mb-1">
                  <p className="text-xl font-bold text-primary">{data.effectivenessScore}%</p>
                  <TrendingUp className="h-3 w-3 text-success" />
                </div>
                <p className="text-xs text-success flex items-center gap-1">
                  <span>Top performer</span>
                </p>
              </div>
              <BarChart3 className="h-5 w-5 text-primary/60 flex-shrink-0" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* TSDL Dashboard */}
      <TSDLDashboard data={data.tsdlData} />


      {/* Teaching Assignments */}
      <AssignmentsSection assignments={data.assignments} />
      {/* Qualifications & Training */}
      <QualificationsSection
        qualifications={data.qualifications}
        professionalDevelopment={data.professionalDevelopment}
        incentives={data.incentives}
      />

      {/* Comprehensive Performance Analytics */}
      <ComprehensivePerformanceAnalytics
        performanceMetrics={data.performanceMetrics}
        resultsMetrics={data.resultsMetrics}
      />
    </div>
  )
}

