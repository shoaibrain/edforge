"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { GraduationCap, Award, FileText, Calendar, DollarSign, Clock, CheckCircle2, AlertCircle, ExternalLink, TrendingUp } from "lucide-react"
import { useMemo } from "react"

interface QualificationsSectionProps {
  qualifications: {
    education: Array<{
      degree: string
      institution: string
      year: number
      gpa?: number
      honors?: string[]
      thesis?: string
      relevantCoursework?: string[]
    }>
    certifications: Array<{
      name: string
      organization: string
      issueDate: string
      expirationDate: string
      status: 'active' | 'expiring_soon' | 'expired'
      renewalRequirements?: string
    }> | string[]
    licenses: Array<{
      name: string
      issuingAuthority: string
      issueDate: string
      expirationDate: string
      status: 'active' | 'expiring_soon' | 'expired'
      renewalRequirements?: string
      renewalDeadline?: string
    }> | string[]
    specializations?: string[]
    languages?: string[]
  }
  professionalDevelopment: Array<{
    title: string
    hours: number
    completed: string
    status: string
    category?: 'pedagogy' | 'technology' | 'subject-matter' | 'leadership'
    provider?: string
    certificateUrl?: string
    skillsGained?: string[]
    impactMetrics?: {
      studentOutcomeImprovement?: number
      engagementIncrease?: number
    }
    recommendations?: string[]
  }>
  incentives: Array<{
    type: string
    amount?: number
    title?: string
    date: string
    reason?: string
    description?: string
  }>
}

export function QualificationsSection({
  qualifications,
  professionalDevelopment,
  incentives,
}: QualificationsSectionProps) {
  // Check if certifications is array of objects or strings
  const certificationsArray = useMemo(() => {
    if (!qualifications.certifications || qualifications.certifications.length === 0) return []
    if (typeof qualifications.certifications[0] === 'string') {
      return (qualifications.certifications as string[]).map((cert) => ({
        name: cert,
        organization: 'Unknown',
        issueDate: '',
        expirationDate: '',
        status: 'active' as const,
      }))
    }
    return qualifications.certifications as Array<{
      name: string
      organization: string
      issueDate: string
      expirationDate: string
      status: 'active' | 'expiring_soon' | 'expired'
      renewalRequirements?: string
    }>
  }, [qualifications.certifications])

  // Check if licenses is array of objects or strings
  const licensesArray = useMemo(() => {
    if (!qualifications.licenses || qualifications.licenses.length === 0) return []
    if (typeof qualifications.licenses[0] === 'string') {
      return (qualifications.licenses as string[]).map((license) => ({
        name: license,
        issuingAuthority: 'Unknown',
        issueDate: '',
        expirationDate: '',
        status: 'active' as const,
      }))
    }
    return qualifications.licenses as Array<{
      name: string
      issuingAuthority: string
      issueDate: string
      expirationDate: string
      status: 'active' | 'expiring_soon' | 'expired'
      renewalRequirements?: string
      renewalDeadline?: string
    }>
  }, [qualifications.licenses])

  // Get status color
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-success/10 text-success border-success/20'
      case 'expiring_soon':
        return 'bg-warning/10 text-warning border-warning/20'
      case 'expired':
        return 'bg-error/10 text-error border-error/20'
      default:
        return 'bg-muted/10 text-muted-foreground border-muted/20'
    }
  }

  // Get category color
  const getCategoryColor = (category?: string) => {
    switch (category) {
      case 'pedagogy':
        return 'bg-primary/10 text-primary border-primary/20'
      case 'technology':
        return 'bg-info/10 text-info border-info/20'
      case 'subject-matter':
        return 'bg-success/10 text-success border-success/20'
      case 'leadership':
        return 'bg-warning/10 text-warning border-warning/20'
      default:
        return 'bg-muted/10 text-muted-foreground border-muted/20'
    }
  }

  // Sort professional development by date
  const sortedPD = useMemo(() => {
    return [...professionalDevelopment].sort((a, b) => 
      new Date(b.completed).getTime() - new Date(a.completed).getTime()
    )
  }, [professionalDevelopment])

  // Sort education by year
  const sortedEducation = useMemo(() => {
    return [...qualifications.education].sort((a, b) => b.year - a.year)
  }, [qualifications.education])

  return (
    <div className="space-y-6">
      {/* Education & Qualifications */}
      <Card className="border-border bg-card shadow-md">
        <CardHeader className="pb-3 border-b border-border/50">
          <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
            <GraduationCap className="h-4 w-4 text-primary" />
            Qualifications & Training
          </CardTitle>
          <CardDescription className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
            Comprehensive view of education, certifications, licenses, and professional development. 
            <span className="text-muted-foreground/60"> SABER:</span> Critical for ensuring well-qualified, 
            systematically trained staff aligned with educational standards.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="space-y-6">
            {/* Education */}
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <GraduationCap className="h-4 w-4 text-primary" />
                Education
              </h3>
              <div className="space-y-3">
                {sortedEducation.map((edu, index) => (
                  <div
                    key={index}
                    className="flex items-start gap-3 p-4 rounded-lg bg-muted/30 border border-border hover:bg-muted/50 transition-colors"
                  >
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <GraduationCap className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p className="font-semibold text-foreground">{edu.degree}</p>
                        <Badge variant="outline" className="text-xs flex-shrink-0">
                          {edu.year}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mb-2">{edu.institution}</p>
                      {edu.gpa && (
                        <p className="text-xs text-muted-foreground mb-1">
                          GPA: <span className="font-medium text-foreground">{edu.gpa.toFixed(1)}</span>
                        </p>
                      )}
                      {edu.honors && edu.honors.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {edu.honors.map((honor, i) => (
                            <Badge key={i} variant="secondary" className="text-xs">
                              {honor}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {edu.thesis && (
                        <p className="text-xs text-muted-foreground mt-2 italic">
                          Thesis: {edu.thesis}
                        </p>
                      )}
                      {edu.relevantCoursework && edu.relevantCoursework.length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs text-muted-foreground mb-1">Relevant Coursework:</p>
                          <div className="flex flex-wrap gap-1">
                            {edu.relevantCoursework.map((course, i) => (
                              <Badge key={i} variant="outline" className="text-xs">
                                {course}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Certifications Grid */}
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <Award className="h-4 w-4 text-primary" />
                Certifications
              </h3>
              <div className="grid gap-3 md:grid-cols-2">
                {certificationsArray.map((cert, index) => (
                  <div
                    key={index}
                    className="p-3 rounded-lg bg-muted/30 border border-border hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <p className="font-medium text-foreground text-sm">{cert.name}</p>
                      <Badge className={`text-xs ${getStatusColor(cert.status)}`}>
                        {cert.status === 'expiring_soon' ? 'Expiring Soon' : cert.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mb-1">{cert.organization}</p>
                    {cert.issueDate && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                        <Calendar className="h-3 w-3" />
                        <span>Issued: {new Date(cert.issueDate).toLocaleDateString()}</span>
                      </div>
                    )}
                    {cert.expirationDate && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                        <Clock className="h-3 w-3" />
                        <span>Expires: {new Date(cert.expirationDate).toLocaleDateString()}</span>
                      </div>
                    )}
                    {'renewalRequirements' in cert && cert.renewalRequirements && (
                      <p className="text-xs text-muted-foreground/70 mt-1">
                        Renewal: {cert.renewalRequirements}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Licenses */}
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                Licenses
              </h3>
              <div className="space-y-3">
                {licensesArray.map((license, index) => (
                  <div
                    key={index}
                    className="p-4 rounded-lg bg-muted/30 border border-border hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <p className="font-medium text-foreground">{license.name}</p>
                      <Badge className={`text-xs ${getStatusColor(license.status)}`}>
                        {license.status === 'expiring_soon' ? 'Expiring Soon' : license.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">{license.issuingAuthority}</p>
                    <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground mb-2">
                      {license.issueDate && (
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          <span>Issued: {new Date(license.issueDate).toLocaleDateString()}</span>
                        </div>
                      )}
                      {license.expirationDate && (
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          <span>Expires: {new Date(license.expirationDate).toLocaleDateString()}</span>
                        </div>
                      )}
                    </div>
                    {'renewalDeadline' in license && license.renewalDeadline && (
                      <div className="flex items-center gap-1 text-xs text-warning mb-1">
                        <AlertCircle className="h-3 w-3" />
                        <span>Renewal Deadline: {new Date(license.renewalDeadline).toLocaleDateString()}</span>
                      </div>
                    )}
                    {'renewalRequirements' in license && license.renewalRequirements && (
                      <p className="text-xs text-muted-foreground/70 mt-1">
                        Requirements: {license.renewalRequirements}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Specializations & Languages */}
            {(qualifications.specializations || qualifications.languages) && (
              <div className="grid gap-4 md:grid-cols-2">
                {qualifications.specializations && qualifications.specializations.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-foreground mb-2">Specializations</h3>
                    <div className="flex flex-wrap gap-2">
                      {qualifications.specializations.map((spec, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">
                          {spec}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {qualifications.languages && qualifications.languages.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-foreground mb-2">Languages</h3>
                    <div className="flex flex-wrap gap-2">
                      {qualifications.languages.map((lang, i) => (
                        <Badge key={i} variant="outline" className="text-xs">
                          {lang}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Professional Development Timeline */}
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                Professional Development
              </h3>
              <div className="space-y-3">
                {sortedPD.map((pd, index) => (
                  <div
                    key={index}
                    className="p-4 rounded-lg bg-muted/30 border border-border hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-medium text-foreground">{pd.title}</p>
                          {pd.category && (
                            <Badge className={`text-xs ${getCategoryColor(pd.category)}`}>
                              {pd.category}
                            </Badge>
                          )}
                        </div>
                        {pd.provider && (
                          <p className="text-xs text-muted-foreground mb-1">{pd.provider}</p>
                        )}
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {pd.hours} hours
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {new Date(pd.completed).toLocaleDateString()}
                          </span>
                        </div>
                        {pd.skillsGained && pd.skillsGained.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-2">
                            {pd.skillsGained.map((skill, i) => (
                              <Badge key={i} variant="outline" className="text-xs">
                                {skill}
                              </Badge>
                            ))}
                          </div>
                        )}
                        {pd.impactMetrics && (
                          <div className="flex items-center gap-4 text-xs mt-2">
                            {pd.impactMetrics.studentOutcomeImprovement && (
                              <div className="flex items-center gap-1 text-success">
                                <TrendingUp className="h-3 w-3" />
                                <span>+{pd.impactMetrics.studentOutcomeImprovement.toFixed(1)}% outcomes</span>
                              </div>
                            )}
                            {pd.impactMetrics.engagementIncrease && (
                              <div className="flex items-center gap-1 text-info">
                                <TrendingUp className="h-3 w-3" />
                                <span>+{pd.impactMetrics.engagementIncrease.toFixed(1)}% engagement</span>
                              </div>
                            )}
                          </div>
                        )}
                        {pd.certificateUrl && (
                          <a
                            href={pd.certificateUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-xs text-primary mt-2 hover:underline"
                          >
                            <ExternalLink className="h-3 w-3" />
                            View Certificate
                          </a>
                        )}
                      </div>
                      <Badge variant="default" className="bg-success text-success-foreground flex-shrink-0">
                        {pd.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Incentives & Recognition */}
      <Card className="border-border bg-card shadow-md">
        <CardHeader className="pb-3 border-b border-border/50">
          <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
            <Award className="h-4 w-4 text-warning" />
            Incentives & Recognition
          </CardTitle>
          <CardDescription className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
            Performance bonuses, awards, and recognition for outstanding contributions to student success.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="space-y-4">
            {incentives.map((incentive, index) => (
              <div
                key={index}
                className="p-4 rounded-lg bg-gradient-to-br from-warning/5 to-warning/10 border border-warning/20 hover:from-warning/10 hover:to-warning/15 transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {incentive.type === "Performance Bonus" ? (
                      <DollarSign className="h-4 w-4 text-warning" />
                    ) : (
                      <Award className="h-4 w-4 text-warning" />
                    )}
                    <p className="font-semibold text-foreground">{incentive.type}</p>
                  </div>
                </div>
                {incentive.title && (
                  <p className="text-sm font-medium text-foreground mb-1">{incentive.title}</p>
                )}
                {incentive.amount && (
                  <p className="text-lg font-bold text-warning mb-1">${incentive.amount.toLocaleString()}</p>
                )}
                {incentive.reason && (
                  <p className="text-xs text-muted-foreground mb-1">{incentive.reason}</p>
                )}
                {incentive.description && (
                  <p className="text-xs text-muted-foreground/70 mb-2">{incentive.description}</p>
                )}
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  <span>{new Date(incentive.date).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
