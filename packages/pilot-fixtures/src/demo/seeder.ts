/**
 * Demo tenant loader — Sprint S1.10.
 *
 * Client-injected so the orchestration is unit-testable without a live
 * backend: the CLI (S1.11) supplies an axios-backed ApiClient; tests supply
 * an in-memory fake. The seeder POSTs a DemoTenantData bundle through the
 * real service create-endpoints in dependency order, resolving each local
 * Ref to the UUID the API returns, and is idempotent — every entity is
 * found-or-created by its natural key, so a re-run is a no-op.
 *
 * Workspace-only (S1.13): this is orchestration over an injected client; it
 * performs no I/O itself and is never imported by a Docker-built service.
 */

import { randomUUID } from 'crypto';

import type { DemoTenantData } from './generate';
import type { Ref } from './generated-types';

/** DDB-bulk max per scores request (bulkExamScoreSchema EXAM_SCORE_BULK_MAX_TOTAL). */
const SCORE_BULK_MAX = 250;

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
}

/** The minimal HTTP surface the seeder needs; implemented by axios/fake. */
export interface ApiClient {
  request<T = unknown>(method: HttpMethod, path: string, body?: unknown): Promise<ApiResponse<T>>;
}

export interface SeedOptions {
  /** Enrol each student into their homeroom's course-sections (heavy). */
  courseSectionMembership?: boolean;
  /** Record exam scores + publish (so result cards generate). */
  recordScoresAndPublish?: boolean;
}

export interface SeedSummary {
  created: Record<string, number>;
  skipped: Record<string, number>;
}

export class SeederError extends Error {
  constructor(
    readonly kind: string,
    readonly path: string,
    readonly status: number,
    readonly responseBody: unknown,
  ) {
    super(
      `seed failed creating ${kind} via ${path}: status ${status} — ${JSON.stringify(responseBody)?.slice(0, 300)}`,
    );
    this.name = 'SeederError';
  }
}

type Row = Record<string, unknown>;

export class DemoSeeder {
  private readonly refs = new Map<Ref, string>();
  private readonly summary: SeedSummary = { created: {}, skipped: {} };

  constructor(
    private readonly client: ApiClient,
    private readonly opts: SeedOptions = {},
  ) {}

  private bump(map: Record<string, number>, kind: string): void {
    map[kind] = (map[kind] ?? 0) + 1;
  }

  private resolve(ref: Ref): string {
    const id = this.refs.get(ref);
    if (!id) throw new Error(`unresolved ref '${ref}' (created out of order?)`);
    return id;
  }

  /** GET a collection; tolerate `[]`, `{items:[]}`, `{data:[]}` shapes. */
  private async list(path: string): Promise<Row[]> {
    const res = await this.client.request<unknown>('GET', path);
    if (res.status < 200 || res.status >= 300) return [];
    const b = res.body as Row | Row[] | { items?: Row[]; data?: Row[] } | null;
    if (Array.isArray(b)) return b;
    if (b && Array.isArray((b as { items?: Row[] }).items)) return (b as { items: Row[] }).items;
    if (b && Array.isArray((b as { data?: Row[] }).data)) return (b as { data: Row[] }).data;
    return [];
  }

  private idOf(row: Row, idField: string): string {
    return String(row[idField] ?? row.id);
  }

  /** Idempotent create: reuse a matching existing row, else POST. */
  private async findOrCreate(args: {
    kind: string;
    listPath: string;
    match: (row: Row) => boolean;
    createPath: string;
    payload: Row;
    idField: string;
  }): Promise<string> {
    const existing = (await this.list(args.listPath)).find(args.match);
    if (existing) {
      this.bump(this.summary.skipped, args.kind);
      return this.idOf(existing, args.idField);
    }
    const res = await this.client.request<Row>('POST', args.createPath, args.payload);
    if (res.status < 200 || res.status >= 300) {
      throw new SeederError(args.kind, args.createPath, res.status, res.body);
    }
    this.bump(this.summary.created, args.kind);
    return this.idOf(res.body, args.idField);
  }

  async seed(data: DemoTenantData): Promise<SeedSummary> {
    const recordScores = this.opts.recordScoresAndPublish ?? true;
    const enrolCourseSections = this.opts.courseSectionMembership ?? true;

    const schoolId = await this.seedSchool(data);
    const yearId = await this.seedAcademicYear(data, schoolId);
    await this.seedTerms(data, schoolId, yearId);
    await this.seedStaff(data, schoolId);
    await this.seedCourses(data, schoolId);
    await this.seedCourseSections(data, schoolId, yearId);
    await this.seedStudents(data, schoolId, yearId, enrolCourseSections);
    await this.seedExam(data, schoolId, yearId, recordScores);
    await this.seedFinance(data, schoolId);

    return this.summary;
  }

  private async seedSchool(data: DemoTenantData): Promise<string> {
    const s = data.school;
    const id = await this.findOrCreate({
      kind: 'school',
      listPath: '/schools',
      match: (r) => r.schoolCode === s.schoolCode,
      createPath: '/schools',
      payload: {
        schoolCode: s.schoolCode,
        name: s.name,
        schoolType: s.schoolType,
        emisSchoolCode: s.emisSchoolCode,
        // `address` is a country-conditional object schema (NPL needs
        // district+province); omit the optional field rather than send the
        // fixture's display string, which the create schema rejects.
        gradeRange: s.gradeRange,
        enabledGradeLevels: s.enabledGradeLevels,
        gradeLevelLabels: s.gradeLevelLabels,
      },
      idField: 'schoolId',
    });
    this.refs.set(s.ref, id);
    return id;
  }

  private async seedAcademicYear(data: DemoTenantData, schoolId: string): Promise<string> {
    const ay = data.academicYear;
    const payload: Row = {
      name: ay.name,
      startDate: ay.startDate,
      endDate: ay.endDate,
      calendarType: ay.calendarType,
      setAsCurrent: true,
    };
    if (ay.startDateBS) payload.startDateBS = ay.startDateBS;
    if (ay.endDateBS) payload.endDateBS = ay.endDateBS;
    const id = await this.findOrCreate({
      kind: 'academicYear',
      listPath: `/schools/${schoolId}/academic-years`,
      match: (r) => r.name === ay.name,
      createPath: `/schools/${schoolId}/academic-years`,
      payload,
      idField: 'yearId',
    });
    this.refs.set(ay.ref, id);
    return id;
  }

  private async seedTerms(data: DemoTenantData, schoolId: string, yearId: string): Promise<void> {
    const base = `/schools/${schoolId}/academic-years/${yearId}/grading-periods`;
    for (const t of data.academicYear.terms) {
      const id = await this.findOrCreate({
        kind: 'term',
        listPath: base,
        match: (r) => r.name === t.name,
        createPath: base,
        payload: {
          name: t.name,
          termType: t.termType,
          sequence: t.sequence,
          startDate: t.startDate,
          endDate: t.endDate,
          examStartDate: t.examStartDate,
          examEndDate: t.examEndDate,
        },
        idField: 'termId',
      });
      this.refs.set(t.ref, id);
    }
  }

  private async seedStaff(data: DemoTenantData, schoolId: string): Promise<void> {
    for (const member of data.staff) {
      const userId = await this.findOrCreate({
        kind: 'user',
        listPath: '/users',
        match: (r) => r.email === member.email,
        createPath: '/users',
        payload: {
          email: member.email,
          firstName: member.firstName,
          lastName: member.lastName,
          phone: member.phone,
          globalRole: member.globalRole,
          schoolId,
          staffRole: member.staffRole,
        },
        idField: 'userId',
      });
      this.refs.set(member.ref, userId);
      // ABAC school-role assignment (idempotent). GET /users/:id/roles returns
      // { userId, globalRole, schoolRoles: [...] } — not a bare collection.
      const rolePath = `/users/${userId}/roles`;
      const rolesRes = await this.client.request<{ schoolRoles?: Row[] }>('GET', rolePath);
      const schoolRoles = Array.isArray(rolesRes.body?.schoolRoles) ? rolesRes.body!.schoolRoles! : [];
      const hasRole = schoolRoles.some((r) => r.role === member.schoolRole && r.schoolId === schoolId);
      if (hasRole) {
        this.bump(this.summary.skipped, 'roleAssignment');
      } else {
        const res = await this.client.request<Row>('POST', rolePath, {
          role: member.schoolRole,
          schoolId,
        });
        if (res.status < 200 || res.status >= 300) {
          throw new SeederError('roleAssignment', rolePath, res.status, res.body);
        }
        this.bump(this.summary.created, 'roleAssignment');
      }
    }
  }

  private async seedCourses(data: DemoTenantData, schoolId: string): Promise<void> {
    for (const c of data.courses) {
      const id = await this.findOrCreate({
        kind: 'course',
        listPath: `/academics/courses?schoolId=${schoolId}`,
        match: (r) => r.courseCode === c.courseCode,
        createPath: '/academics/courses',
        payload: {
          courseCode: c.courseCode,
          courseName: c.courseName,
          schoolId,
          gradeLevels: [c.gradeCode],
          credits: c.credits,
          courseType: c.courseType,
          typicalDuration: c.typicalDuration,
          subjectArea: c.subjectArea,
        },
        idField: 'courseId',
      });
      this.refs.set(c.ref, id);
    }
  }

  private async seedCourseSections(
    data: DemoTenantData,
    schoolId: string,
    yearId: string,
  ): Promise<void> {
    for (const cs of data.courseSections) {
      const courseId = this.resolve(cs.courseRef);
      const teacherId = this.resolve(cs.primaryTeacherRef);
      const id = await this.findOrCreate({
        kind: 'courseSection',
        listPath: `/academics/sections?schoolId=${schoolId}`,
        match: (r) => r.courseId === courseId && r.sectionNumber === cs.sectionNumber,
        createPath: '/academics/sections',
        payload: {
          courseId,
          schoolId,
          academicYearId: yearId,
          sectionNumber: cs.sectionNumber,
          primaryTeacherId: teacherId,
          maxEnrollment: cs.maxEnrollment,
        },
        idField: 'sectionId',
      });
      this.refs.set(cs.ref, id);
    }
  }

  private async seedStudents(
    data: DemoTenantData,
    schoolId: string,
    yearId: string,
    enrolCourseSections: boolean,
  ): Promise<void> {
    // homeroom ref → its course-section refs (for membership enrolment)
    const byHomeroom = new Map<Ref, Ref[]>();
    for (const cs of data.courseSections) {
      const list = byHomeroom.get(cs.homeroomRef) ?? [];
      list.push(cs.ref);
      byHomeroom.set(cs.homeroomRef, list);
    }

    for (const st of data.students) {
      const payload: Row = {
        firstName: st.firstName,
        lastName: st.lastName,
        dateOfBirth: st.dateOfBirth,
        gender: st.gender,
        schoolId,
        currentGradeLevel: st.gradeCode,
        email: st.email,
        studentNumber: st.studentNumber,
        guardians: st.guardians,
      };
      if (st.emisStudentId) payload.emisStudentId = st.emisStudentId;
      const studentId = await this.findOrCreate({
        kind: 'student',
        listPath: `/academics/students?schoolId=${schoolId}`,
        match: (r) => r.studentNumber === st.studentNumber,
        createPath: '/academics/students',
        payload,
        idField: 'studentId',
      });
      this.refs.set(st.ref, studentId);

      // Grade-level enrolment (idempotent by studentId). The flat
      // GET /academics/enrollments route does not exist — list via the
      // school/year-scoped route. Capture the enrollmentId: exam scores are
      // keyed by enrollment, not student.
      const enrolPath = '/academics/enrollments';
      const enrolListPath = `/academics/schools/${schoolId}/years/${yearId}/enrollments`;
      const existingEnrol = (await this.list(enrolListPath)).find((r) => r.studentId === studentId);
      let enrollmentId: string;
      if (existingEnrol) {
        enrollmentId = String(existingEnrol.enrollmentId ?? existingEnrol.id);
        this.bump(this.summary.skipped, 'enrollment');
      } else {
        const res = await this.client.request<Row>('POST', enrolPath, {
          studentId,
          schoolId,
          academicYearId: yearId,
          gradeLevel: st.gradeCode,
          enrollmentDate: st.enrollmentDate,
          enrollmentType: 'new',
        });
        if (res.status < 200 || res.status >= 300) {
          throw new SeederError('enrollment', enrolPath, res.status, res.body);
        }
        enrollmentId = this.idOf(res.body, 'enrollmentId');
        this.bump(this.summary.created, 'enrollment');
      }
      this.refs.set(`enrollment:${st.ref}`, enrollmentId);

      // Course-section membership (optional; bounded by students × courses).
      if (enrolCourseSections) {
        for (const csRef of byHomeroom.get(st.sectionRef) ?? []) {
          const sectionId = this.resolve(csRef);
          const memberPath = `/academics/sections/${sectionId}/students`;
          // GET returns { sectionId, students: [...], totalCount } — not a bare list.
          const rosterRes = await this.client.request<{ students?: Row[] }>('GET', memberPath);
          const members = Array.isArray(rosterRes.body?.students) ? rosterRes.body!.students! : [];
          const isMember = members.some((m) => (m.studentId ?? m.id) === studentId);
          if (isMember) {
            this.bump(this.summary.skipped, 'sectionMembership');
          } else {
            const res = await this.client.request<Row>('POST', memberPath, { studentId });
            if (res.status < 200 || res.status >= 300) {
              throw new SeederError('sectionMembership', memberPath, res.status, res.body);
            }
            this.bump(this.summary.created, 'sectionMembership');
          }
        }
      }
    }
  }

  private async seedExam(
    data: DemoTenantData,
    schoolId: string,
    yearId: string,
    recordScores: boolean,
  ): Promise<void> {
    const exam = data.exam;
    const existing = (await this.list(`/academics/exams?schoolId=${schoolId}`)).find(
      (r) => r.examName === exam.examName && r.academicYearId === yearId,
    );
    if (existing) {
      // Re-run: the exam and its whole sub-flow (courses/scores/status) are
      // already seeded. (B2: a partial prior failure would not self-heal here;
      // operator re-creates the exam to retry.)
      this.refs.set(exam.ref, this.idOf(existing, 'examId'));
      this.bump(this.summary.skipped, 'exam');
      return;
    }

    const examRes = await this.client.request<Row>('POST', '/academics/exams', {
      examName: exam.examName,
      schoolId,
      academicYearId: yearId,
      termId: this.resolve(exam.termRef),
      examType: exam.examType,
      gradeLevels: exam.gradeCodes,
      startDate: exam.startDate,
      endDate: exam.endDate,
    });
    if (examRes.status < 200 || examRes.status >= 300) {
      throw new SeederError('exam', '/academics/exams', examRes.status, examRes.body);
    }
    const examId = this.idOf(examRes.body, 'examId');
    this.refs.set(exam.ref, examId);
    this.bump(this.summary.created, 'exam');

    // ExamCourses (subjects) must be created while the exam is draft/scheduled.
    const coursePath = `/academics/exams/${examId}/courses`;
    for (const ec of data.examCourses) {
      const res = await this.client.request<Row>('POST', coursePath, {
        schoolId,
        courseId: this.resolve(ec.courseRef),
        maxMarks: ec.maxMarks,
        passingMarks: ec.passingMarks,
      });
      if (res.status < 200 || res.status >= 300) {
        throw new SeederError('examCourse', coursePath, res.status, res.body);
      }
      this.refs.set(ec.ref, this.idOf(res.body, 'examCourseId'));
      this.bump(this.summary.created, 'examCourse');
    }

    if (!recordScores) return;

    // Walk to in_progress so scores are accepted (no status skips allowed).
    await this.transitionExam(examId, 'scheduled');
    await this.transitionExam(examId, 'in_progress');

    // Bulk scores keyed by (examCourseId, enrollmentId), chunked under the limit.
    const scores = data.marks.map((m) => ({
      examCourseId: this.resolve(m.examCourseRef),
      enrollmentId: this.resolve(`enrollment:${m.studentRef}`),
      rawScore: m.rawScore,
    }));
    const scorePath = `/academics/exams/${examId}/scores/bulk?schoolId=${schoolId}`;
    for (let i = 0; i < scores.length; i += SCORE_BULK_MAX) {
      const res = await this.client.request<Row>('POST', scorePath, {
        correlationId: randomUUID(),
        scores: scores.slice(i, i + SCORE_BULK_MAX),
      });
      if (res.status < 200 || res.status >= 300) {
        throw new SeederError('examScores', scorePath, res.status, res.body);
      }
      this.bump(this.summary.created, 'examScores');
    }

    // Close (result cards generate) then publish.
    await this.transitionExam(examId, 'closed');
    await this.transitionExam(examId, 'published');
  }

  private async transitionExam(examId: string, targetStatus: string): Promise<void> {
    const path = `/academics/exams/${examId}/status`;
    const res = await this.client.request<Row>('PATCH', path, { targetStatus });
    if (res.status < 200 || res.status >= 300) {
      throw new SeederError(`examTransition:${targetStatus}`, path, res.status, res.body);
    }
    this.bump(this.summary.created, `examStatus:${targetStatus}`);
  }

  private async seedFinance(data: DemoTenantData, schoolId: string): Promise<void> {
    const feeBase = `/finance/schools/${schoolId}/fee-structures`;
    for (const fee of data.feeStructures) {
      const payload: Row = {
        name: fee.name,
        academicYearId: this.resolve(data.academicYear.ref),
        academicYear: data.academicYear.name,
        feeType: fee.feeType,
        amount: fee.amount,
        frequency: fee.frequency,
        // Send currency explicitly: createFeeStructureSchema defaults it to NPR
        // at the validation boundary, which would mis-currency a GENERIC tenant.
        currency: data.config.currency,
        effectiveFrom: data.academicYear.startDate,
      };
      if (fee.gradeCode) payload.gradeLevels = [fee.gradeCode];
      const id = await this.findOrCreate({
        kind: 'feeStructure',
        listPath: feeBase,
        match: (r) => r.name === fee.name,
        createPath: feeBase,
        payload,
        idField: 'id',
      });
      this.refs.set(fee.ref, id);
    }

    const invBase = `/finance/schools/${schoolId}/invoices`;
    for (const inv of data.invoices) {
      const studentId = this.resolve(inv.studentRef);
      const id = await this.findOrCreate({
        kind: 'invoice',
        listPath: invBase,
        match: (r) => r.studentId === studentId && r.academicYear === data.academicYear.name,
        createPath: invBase,
        payload: {
          studentId,
          academicYear: data.academicYear.name,
          feeStructureIds: inv.feeStructureRefs.map((r) => this.resolve(r)),
          dueDate: inv.dueDate,
          autoIssue: true,
        },
        idField: 'id',
      });
      this.refs.set(inv.ref, id);
    }

    const payBase = `/finance/schools/${schoolId}/payments/manual`;
    const payList = `/finance/schools/${schoolId}/payments`;
    for (const pay of data.payments) {
      const invoiceId = this.resolve(pay.invoiceRef);
      const exists = (await this.list(payList)).some((r) => r.invoiceId === invoiceId);
      if (exists) {
        this.bump(this.summary.skipped, 'payment');
        continue;
      }
      const res = await this.client.request<Row>('POST', payBase, {
        invoiceId,
        gateway: pay.gateway,
        amount: pay.amount,
        paidDate: pay.paidDate,
      });
      if (res.status < 200 || res.status >= 300) {
        throw new SeederError('payment', payBase, res.status, res.body);
      }
      this.bump(this.summary.created, 'payment');
    }
  }
}
