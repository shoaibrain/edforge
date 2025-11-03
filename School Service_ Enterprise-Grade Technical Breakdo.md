

# School Service: Database architecture and implementation plan

Based on the SABER framework requirements and your existing ECS reference architecture, here's the comprehensive technical breakdown for the **School Service** as the foundation layer of your multi-tenant education SaaS platform.


## Guiding Question
How can technology improve the availability and use of data for effective decision-making in education?
In this multi tenant edforge b2b SaaS enterprise application, the high level requirement is that a teannt can have more than one school, and all the school operations, activities, should be very carefully and inteligentally secure and data should be robust, accurate, secure and have tracibility, that later will help me drive school progress, and decisions making. so therefore, we have to be very careful and articulate about the database design and implementation plan. 

In this document, We want to focus mainly on the service school database design with scalability and maintainibility in mind while understand the other core services of the applications like academic service, student service, etc.. 



### Key Business Rules:

- **Multi-School Tenants**: A tenant can operate multiple schools (district-level organization)
- **School Independence**: Each school operates with separate data isolation and independent configurations
- **Temporal Boundaries**: Academic years define boundaries for all academic operations and data archival
- **Organizational Structure**: Departments structure teaching staff allocation and budget management
- **Operational Flexibility**: School configurations control operational parameters per institution


## Database Schema Design


## Rough database schema design choice for service school in 

Schools Table - Foundation entity:
CREATE TABLE schools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(64) NOT NULL,
    
    -- Core identification
    name VARCHAR(255) NOT NULL,
    school_code VARCHAR(50) NOT NULL,
    school_type VARCHAR(50) NOT NULL CHECK (school_type IN ('elementary', 'middle', 'high', 'k12')),
    
    -- JSONB for flexibility (SABER requirement)
    operational_config JSONB NOT NULL DEFAULT '{}', -- timezone, locale, calendar_type
    academic_config JSONB NOT NULL DEFAULT '{}', -- grading_scale, promotion_criteria
    system_config JSONB NOT NULL DEFAULT '{}', -- feature_flags, integrations
    contact_info JSONB NOT NULL DEFAULT '{}', -- phone, email, website
    address JSONB NOT NULL DEFAULT '{}', -- full address structure
    
    -- Administrative
    principal_user_id UUID, -- References Control Plane User Service
    max_students INTEGER DEFAULT 2000,
    status VARCHAR(20) DEFAULT 'active',
    
    -- Audit (SABER compliance)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT schools_tenant_code_unique UNIQUE (tenant_id, school_code)
);


### Academic Years - Temporal boundaries:

CREATE TABLE academic_years (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(64) NOT NULL,
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    
    name VARCHAR(100) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_current BOOLEAN DEFAULT FALSE,
    
    -- JSONB for academic structure flexibility
    academic_structure JSONB NOT NULL DEFAULT '{
        "semesters": 2,
        "grading_periods": [],
        "holidays": [],
        "important_dates": []
    }',
    
    tuition_rates JSONB DEFAULT '{}', -- Per grade, per program
    status VARCHAR(20) DEFAULT 'planned',
    
    CONSTRAINT academic_years_date_valid CHECK (end_date > start_date),
    CONSTRAINT academic_years_tenant_school_name UNIQUE (tenant_id, school_id, name)
);
### Departments - Organizational structure with budget tracking, departmental progression and stats, school organizational view
CREATE TABLE departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(64) NOT NULL,
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    
    name VARCHAR(255) NOT NULL,
    department_code VARCHAR(20) NOT NULL,
    head_of_department_user_id UUID,
    
    -- JSONB for complex department data
    budget_info JSONB DEFAULT '{
        "annual_budget": 0,
        "currency": "USD", 
        "expenditures": []
    }',
    academic_info JSONB DEFAULT '{
        "subjects": [],
        "grade_levels": [],
        "curriculum_standards": []
    }',
    resources JSONB DEFAULT '{
        "facilities": [],
        "equipment": [],
        "textbooks": []
    }',
    
    CONSTRAINT departments_tenant_school_code UNIQUE (tenant_id, school_id, department_code)
);
Multi-Tenant Isolation Strategy
Row-Level Security Implementation​

-- Enable RLS on all tables
ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
CREATE POLICY schools_tenant_policy ON schools 
FOR ALL TO application_role 
USING (tenant_id = current_setting('app.tenant_id'));
Performance & Scaling Strategy
JSONB Optimization:​
sql
-- GIN indexes for complex JSONB queries
CREATE INDEX idx_schools_configs_gin ON schools USING GIN(operational_config, academic_config);

-- B-tree indexes for specific paths
CREATE INDEX idx_schools_timezone ON schools((operational_config->>'timezone'))

### 2. School Activity Log Table

**Purpose**: Time-series audit log for compliance and monitoring
**Partition Key**: `tenant_id#school_id#date` (YYYY-MM-DD format)
**Sort Key**: `timestamp#activity_id`

**Compliance Features**:

- FERPA audit requirements with 2-year TTL
- IP address and user agent tracking
- Severity levels for security monitoring


### 3. School Metadata Table

**Purpose**: Flexible custom fields and integration settings
**Partition Key**: `tenant_id#school_id`
**Sort Key**: `metadata_type` (custom_fields, integrations, preferences)

## SABER Framework Compliance

### Enabling Environment

- **Legal Framework**: Tenant-specific data governance in configurations, Row-level security enforcement
- **Organizational Structure**: Department hierarchy, grade level progression criteria
- **Human Resources**: Principal assignments, department head management


### System Soundness

- **Data Architecture**: Polyglot persistence (Aurora DSQL + DynamoDB)
- **Strong Consistency**: Organizational structure and academic boundaries
- **Eventual Consistency**: Cache layers and activity logs


### Quality Data

- **Accuracy \& Reliability**: Database constraints, unique constraints, foreign key integrity
- **Timeliness**: Real-time cache updates with 1-hour TTL, millisecond precision logging
- **Methodological Soundness**: Standard UUID keys, consistent audit patterns


### Utilization for Decision Making

- **Accessibility**: RESTful APIs, cached high-performance reads
- **Effectiveness**: Performance dashboards, academic progression tracking
- **Operational Use**: Cross-service integration, event-driven coordination


## Integration with ECS Reference Architecture

### Service Structure (following existing patterns):

```
├── src
│   ├── main.ts
│   └── schools
│       ├── dto
│       │   └── create-school.dto.ts
│       ├── entities
│       │   └── school.entity.ts
│       ├── schools.controller.ts
│       ├── schools.module.ts
│       └── schools.service.ts
└── tsconfig.app.json
```


### Key API Endpoints:

- `GET /schools` - List tenant schools with pagination
- `POST /schools` - Create new school
- `GET /schools/{id}/academic-years` - Academic year management
- `GET /schools/{id}/departments` - Department structure
- `PUT /schools/{id}/configuration` - School settings management


### Domain Events:

- **SchoolCreated** - Triggers downstream service provisioning
- **AcademicYearStarted** - Initiates enrollment and scheduling processes
- **DepartmentRestructured** - Updates staff assignments and budgets

