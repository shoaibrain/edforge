# EdForge Frontend-Backend Integration Guide

## Architecture Overview

EdForge implements a **Zod schema-first approach** for data validation and TypeScript type generation, ensuring consistency between frontend and backend. The architecture uses:

- **@edforge/shared-types**: Single source of truth for schemas, types, and validators
- **nestjs-zod**: Backend validation with automatic DTO generation
- **react-hook-form + zod**: Frontend form validation and state management
- **Ed-Fi compliant models**: Scalable data objects for education entities

---

## 1. Zod Schema-First Architecture

### Core Principles

1. **Single Source of Truth**: All data shapes defined once in `@edforge/shared-types`
2. **Runtime Validation**: Zod schemas validate data at runtime in both frontend and backend
3. **TypeScript Inference**: Types automatically generated from schemas (`z.infer<typeof schema>`)
4. **No Drift**: Impossible for frontend and backend types to become out of sync

### Schema Structure

```typescript
// packages/shared-types/src/schemas/identity/user.schema.ts
import { z } from 'zod';
import { emailSchema, phoneSchema, isoDateSchema } from '../common';

// Base schemas
export const userAddressSchema = z.object({
  street: z.string().max(100).optional(),
  city: z.string().max(50).optional(),
  state: z.string().max(50).optional(),
  postalCode: z.string().max(20).optional(),
  country: z.string().max(50).optional(),
});

// Enums
export const userStatusSchema = z.enum(['active', 'inactive', 'pending', 'suspended', 'locked']);
export const globalRoleSchema = z.enum(['TenantAdmin', 'StandardUser']);

// DTO schemas
export const createUserSchema = z.object({
  email: emailSchema,
  firstName: z.string().min(2).max(50),
  lastName: z.string().min(2).max(50),
  globalRole: globalRoleSchema.default('StandardUser'),
});

// Response schemas
export const userResponseSchema = z.object({
  userId: z.string(),
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  status: userStatusSchema,
  globalRole: globalRoleSchema,
  // ... additional fields
});

// TypeScript types (auto-inferred)
export type CreateUserDto = z.infer<typeof createUserSchema>;
export type UserResponseDto = z.infer<typeof userResponseSchema>;
export type UserAddressDto = z.infer<typeof userAddressSchema>;
```

### Backend Integration

```typescript
// server/application/microservices/identity/src/common/dto/zod-dtos.ts
import { createZodDto } from 'nestjs-zod';
import { createUserSchema, updateUserSchema } from '@edforge/shared-types';

// Create NestJS-compatible DTO classes
export class CreateUserDtoZ extends createZodDto(createUserSchema) {}
export class UpdateUserDtoZ extends createZodDto(updateUserSchema) {}

// server/application/microservices/identity/src/main.ts
import { ZodValidationPipe } from 'nestjs-zod';

app.useGlobalPipes(new ZodValidationPipe()); // Global validation
```

---

## 2. Form Design Patterns

### React Hook Form + Zod Integration

#### Base Form Hook

```typescript
// hooks/useFormValidation.ts
import { useForm, UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

export function useFormValidation<T extends z.ZodSchema>(
  schema: T,
  defaultValues?: Partial<z.infer<T>>
): UseFormReturn<z.infer<T>> {
  return useForm<z.infer<T>>({
    resolver: zodResolver(schema),
    defaultValues,
    mode: 'onBlur', // Validate on blur for better UX
  });
}
```

#### Form Component Pattern

```typescript
// components/forms/UserForm.tsx
import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, TextField, Alert } from '@mui/material';
import {
  createUserSchema,
  updateUserSchema,
  CreateUserDto,
  UpdateUserDto,
} from '@edforge/shared-types';

interface UserFormProps {
  user?: UpdateUserDto;
  onSubmit: (data: CreateUserDto | UpdateUserDto) => Promise<void>;
  loading?: boolean;
  error?: string;
}

export const UserForm: React.FC<UserFormProps> = ({
  user,
  onSubmit,
  loading,
  error,
}) => {
  const schema = user ? updateUserSchema : createUserSchema;
  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
    reset,
  } = useForm<CreateUserDto | UpdateUserDto>({
    resolver: zodResolver(schema),
    defaultValues: user || {},
  });

  const onFormSubmit = async (data: CreateUserDto | UpdateUserDto) => {
    try {
      await onSubmit(data);
      if (!user) reset(); // Clear form on successful create
    } catch (error) {
      // Error handled by parent component
    }
  };

  return (
    <form onSubmit={handleSubmit(onFormSubmit)}>
      {error && <Alert severity="error">{error}</Alert>}

      <TextField
        {...register('firstName')}
        label="First Name"
        error={!!errors.firstName}
        helperText={errors.firstName?.message}
        fullWidth
        required
      />

      <TextField
        {...register('lastName')}
        label="Last Name"
        error={!!errors.lastName}
        helperText={errors.lastName?.message}
        fullWidth
        required
      />

      <TextField
        {...register('email')}
        label="Email"
        type="email"
        error={!!errors.email}
        helperText={errors.email?.message}
        fullWidth
        required={!user} // Email not updatable
        disabled={!!user}
      />

      <Button
        type="submit"
        disabled={loading || !isValid}
        fullWidth
      >
        {loading ? 'Saving...' : user ? 'Update User' : 'Create User'}
      </Button>
    </form>
  );
};
```

#### Address Sub-Form Component

```typescript
// components/forms/AddressForm.tsx
import React from 'react';
import { useFormContext } from 'react-hook-form';
import { TextField, Grid } from '@mui/material';
import { UserAddressDto } from '@edforge/shared-types';

interface AddressFormProps {
  prefix?: string; // For nested forms (e.g., 'address.' or 'guardian.0.address.')
}

export const AddressForm: React.FC<AddressFormProps> = ({ prefix = '' }) => {
  const { register, formState: { errors } } = useFormContext();

  const getFieldName = (field: keyof UserAddressDto) =>
    prefix ? `${prefix}${field}` : field;

  const getError = (field: keyof UserAddressDto) => {
    const fieldPath = getFieldName(field);
    return fieldPath.split('.').reduce((obj, key) => obj?.[key], errors);
  };

  return (
    <Grid container spacing={2}>
      <Grid item xs={12}>
        <TextField
          {...register(getFieldName('street'))}
          label="Street Address"
          error={!!getError('street')}
          helperText={getError('street')?.message}
          fullWidth
        />
      </Grid>
      <Grid item xs={12}>
        <TextField
          {...register(getFieldName('street2'))}
          label="Street Address 2"
          error={!!getError('street2')}
          helperText={getError('street2')?.message}
          fullWidth
        />
      </Grid>
      <Grid item xs={12} sm={6}>
        <TextField
          {...register(getFieldName('city'))}
          label="City"
          error={!!getError('city')}
          helperText={getError('city')?.message}
          fullWidth
        />
      </Grid>
      <Grid item xs={12} sm={3}>
        <TextField
          {...register(getFieldName('state'))}
          label="State"
          error={!!getError('state')}
          helperText={getError('state')?.message}
          fullWidth
        />
      </Grid>
      <Grid item xs={12} sm={3}>
        <TextField
          {...register(getFieldName('postalCode'))}
          label="ZIP Code"
          error={!!getError('postalCode')}
          helperText={getError('postalCode')?.message}
          fullWidth
        />
      </Grid>
      <Grid item xs={12}>
        <TextField
          {...register(getFieldName('country'))}
          label="Country"
          error={!!getError('country')}
          helperText={getError('country')?.message}
          fullWidth
        />
      </Grid>
    </Grid>
  );
};
```

### Password Validation Component

```typescript
// components/forms/PasswordField.tsx
import React, { useState } from 'react';
import { useFormContext } from 'react-hook-form';
import {
  TextField,
  IconButton,
  InputAdornment,
  FormHelperText,
} from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import { passwordSchema, COGNITO_PASSWORD_REQUIREMENTS } from '@edforge/shared-types';

interface PasswordFieldProps {
  name: string;
  label: string;
  showRequirements?: boolean;
}

export const PasswordField: React.FC<PasswordFieldProps> = ({
  name,
  label,
  showRequirements = false,
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const { register, formState: { errors }, watch } = useFormContext();

  const password = watch(name);
  const requirements = [
    {
      met: password?.length >= COGNITO_PASSWORD_REQUIREMENTS.minLength,
      text: `At least ${COGNITO_PASSWORD_REQUIREMENTS.minLength} characters`,
    },
    {
      met: password?.length <= COGNITO_PASSWORD_REQUIREMENTS.maxLength,
      text: `No more than ${COGNITO_PASSWORD_REQUIREMENTS.maxLength} characters`,
    },
    {
      met: /[a-z]/.test(password || ''),
      text: 'One lowercase letter',
    },
    {
      met: /[A-Z]/.test(password || ''),
      text: 'One uppercase letter',
    },
    {
      met: /\d/.test(password || ''),
      text: 'One number',
    },
    {
      met: new RegExp(`[${COGNITO_PASSWORD_REQUIREMENTS.allowedSymbols.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]`).test(password || ''),
      text: `One special character: ${COGNITO_PASSWORD_REQUIREMENTS.allowedSymbols}`,
    },
  ];

  return (
    <div>
      <TextField
        {...register(name)}
        label={label}
        type={showPassword ? 'text' : 'password'}
        error={!!errors[name]}
        fullWidth
        InputProps={{
          endAdornment: (
            <InputAdornment position="end">
              <IconButton
                onClick={() => setShowPassword(!showPassword)}
                edge="end"
              >
                {showPassword ? <VisibilityOff /> : <Visibility />}
              </IconButton>
            </InputAdornment>
          ),
        }}
      />
      {errors[name] && (
        <FormHelperText error>{errors[name]?.message}</FormHelperText>
      )}
      {showRequirements && (
        <div style={{ marginTop: 8 }}>
          <FormHelperText>Password requirements:</FormHelperText>
          {requirements.map((req, index) => (
            <FormHelperText
              key={index}
              style={{
                color: req.met ? 'green' : 'text.secondary',
                fontSize: '0.75rem',
              }}
            >
              {req.met ? '✓' : '○'} {req.text}
            </FormHelperText>
          ))}
        </div>
      )}
    </div>
  );
};
```

---

## 3. API Client Implementation

### Base API Service

```typescript
// services/api/base.ts
import axios, { AxiosInstance, AxiosResponse, AxiosError } from 'axios';
import { z } from 'zod';

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public errorCode?: string,
    public field?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ApiService {
  protected api: AxiosInstance;
  private getAccessToken?: () => string | undefined;

  constructor(baseURL: string) {
    this.api = axios.create({
      baseURL,
      timeout: 30000, // 30 seconds for education data
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.setupInterceptors();
  }

  setTokenProvider(getAccessToken: () => string | undefined) {
    this.getAccessToken = getAccessToken;
  }

  private setupInterceptors() {
    // Request interceptor
    this.api.interceptors.request.use((config) => {
      const token = this.getAccessToken?.();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      // Add tenant context from localStorage or context
      const tenantId = localStorage.getItem('currentTenantId');
      if (tenantId) {
        config.headers['X-Tenant-Id'] = tenantId;
      }
      return config;
    });

    // Response interceptor
    this.api.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        if (error.response?.status === 401) {
          // Trigger auth refresh or redirect
          window.location.href = '/login';
          return Promise.reject(error);
        }

        if (error.response?.data) {
          const data = error.response.data as any;
          throw new ApiError(
            error.response.status,
            data.message || 'An error occurred',
            data.errorCode,
            data.field
          );
        }

        throw new ApiError(500, 'Network error');
      }
    );
  }

  protected async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    data?: any,
    schema?: z.ZodSchema<T>
  ): Promise<T> {
    const response: AxiosResponse = await this.api.request({
      method,
      url,
      data,
    });

    // Validate response if schema provided
    if (schema) {
      const result = schema.safeParse(response.data);
      if (!result.success) {
        console.error('API Response validation failed:', result.error);
        throw new ApiError(500, 'Invalid API response format');
      }
      return result.data;
    }

    return response.data;
  }
}
```

### Domain-Specific API Clients

```typescript
// services/api/userApi.ts
import { ApiService } from './base';
import {
  CreateUserDto,
  UpdateUserDto,
  UserResponseDto,
  UserListResponseDto,
  UpdatePreferencesDto,
  UserPreferencesResponseDto,
  ChangePasswordDto,
} from '@edforge/shared-types';

export class UserApi extends ApiService {
  constructor() {
    super('/api/identity'); // Base URL for identity service
  }

  // User CRUD operations
  async createUser(data: CreateUserDto): Promise<UserResponseDto> {
    return this.request('POST', '/users', data);
  }

  async getUser(userId: string): Promise<UserResponseDto> {
    return this.request('GET', `/users/${userId}`);
  }

  async updateUser(userId: string, data: UpdateUserDto): Promise<UserResponseDto> {
    return this.request('PATCH', `/users/${userId}`, data);
  }

  async listUsers(params?: {
    limit?: number;
    cursor?: string;
    searchTerm?: string;
  }): Promise<UserListResponseDto> {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', params.limit.toString());
    if (params?.cursor) query.set('cursor', params.cursor);
    if (params?.searchTerm) query.set('searchTerm', params.searchTerm);

    return this.request('GET', `/users?${query.toString()}`);
  }

  // User preferences
  async getPreferences(userId: string): Promise<UserPreferencesResponseDto> {
    return this.request('GET', `/users/${userId}/preferences`);
  }

  async updatePreferences(
    userId: string,
    data: UpdatePreferencesDto
  ): Promise<UserPreferencesResponseDto> {
    return this.request('PATCH', `/users/${userId}/preferences`, data);
  }

  // Security operations
  async changePassword(userId: string, data: ChangePasswordDto): Promise<void> {
    return this.request('POST', `/users/${userId}/security/change-password`, data);
  }

  // Bulk operations
  async bulkCreateUsers(data: CreateUserDto[]): Promise<UserResponseDto[]> {
    return this.request('POST', '/users/bulk', data);
  }

  async bulkUpdateUsers(updates: Array<{
    userId: string;
    data: UpdateUserDto;
  }>): Promise<UserResponseDto[]> {
    return this.request('PATCH', '/users/bulk', updates);
  }
}

// Singleton instance
export const userApi = new UserApi();
```

```typescript
// services/api/studentApi.ts
import { ApiService } from './base';
import {
  CreateStudentDto,
  UpdateStudentDto,
  StudentResponseDto,
  StudentListResponseDto,
  StudentProfileResponseDto,
  StudentFilterDto,
} from '@edforge/shared-types';

export class StudentApi extends ApiService {
  constructor() {
    super('/api/academics'); // Base URL for academics service
  }

  // Student CRUD
  async createStudent(data: CreateStudentDto): Promise<StudentResponseDto> {
    return this.request('POST', '/students', data);
  }

  async getStudent(studentId: string): Promise<StudentResponseDto> {
    return this.request('GET', `/students/${studentId}`);
  }

  async updateStudent(studentId: string, data: UpdateStudentDto): Promise<StudentResponseDto> {
    return this.request('PATCH', `/students/${studentId}`, data);
  }

  async getStudentProfile(studentId: string): Promise<StudentProfileResponseDto> {
    return this.request('GET', `/students/${studentId}/profile`);
  }

  // List and search
  async listStudents(params: {
    schoolId?: string;
    limit?: number;
    cursor?: string;
    filter?: StudentFilterDto;
  } = {}): Promise<StudentListResponseDto> {
    const query = new URLSearchParams();
    if (params.schoolId) query.set('schoolId', params.schoolId);
    if (params.limit) query.set('limit', params.limit.toString());
    if (params.cursor) query.set('cursor', params.cursor);

    // Add filter parameters
    if (params.filter) {
      Object.entries(params.filter).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          query.set(key, String(value));
        }
      });
    }

    return this.request('GET', `/students?${query.toString()}`);
  }

  // Bulk operations
  async bulkCreateStudents(data: CreateStudentDto[]): Promise<StudentResponseDto[]> {
    return this.request('POST', '/students/bulk', data);
  }

  async bulkUpdateStudents(updates: Array<{
    studentId: string;
    data: UpdateStudentDto;
  }>): Promise<StudentResponseDto[]> {
    return this.request('PATCH', '/students/bulk', updates);
  }

  // Enrollment operations
  async enrollStudent(studentId: string, data: {
    academicYearId: string;
    gradeLevel: string;
    enrollmentDate: string;
    homeroomId?: string;
  }): Promise<void> {
    return this.request('POST', `/students/${studentId}/enroll`, data);
  }

  async withdrawStudent(studentId: string, data: {
    withdrawalDate: string;
    reason?: string;
    comments?: string;
  }): Promise<void> {
    return this.request('POST', `/students/${studentId}/withdraw`, data);
  }
}

export const studentApi = new StudentApi();
```

### React Query Integration

```typescript
// hooks/useApi.ts
import { useMutation, useQuery, useQueryClient, UseQueryOptions, UseMutationOptions } from '@tanstack/react-query';
import { ApiError } from '../services/api/base';

// Generic query hook
export function useApiQuery<T>(
  queryKey: string[],
  queryFn: () => Promise<T>,
  options?: Omit<UseQueryOptions<T, ApiError>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey,
    queryFn,
    retry: (failureCount, error) => {
      // Don't retry on 4xx errors
      if (error.statusCode >= 400 && error.statusCode < 500) {
        return false;
      }
      return failureCount < 3;
    },
    ...options,
  });
}

// Generic mutation hook
export function useApiMutation<TData, TVariables>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  options?: UseMutationOptions<TData, ApiError, TVariables>
) {
  return useMutation({
    mutationFn,
    retry: (failureCount, error) => {
      // Don't retry mutations on client errors
      if (error.statusCode >= 400 && error.statusCode < 500) {
        return false;
      }
      return failureCount < 1;
    },
    ...options,
  });
}
```

```typescript
// hooks/useUsers.ts
import { useApiQuery, useApiMutation } from './useApi';
import { userApi } from '../services/api/userApi';
import {
  CreateUserDto,
  UpdateUserDto,
  UserResponseDto,
  UserListResponseDto,
} from '@edforge/shared-types';

export function useUsers(schoolId?: string) {
  return useApiQuery(
    ['users', schoolId],
    () => userApi.listUsers({ limit: 50 }),
    {
      staleTime: 5 * 60 * 1000, // 5 minutes
    }
  );
}

export function useUser(userId: string) {
  return useApiQuery(
    ['users', userId],
    () => userApi.getUser(userId),
    {
      enabled: !!userId,
    }
  );
}

export function useCreateUser() {
  return useApiMutation(
    (data: CreateUserDto) => userApi.createUser(data),
    {
      onSuccess: () => {
        // Invalidate and refetch users list
        queryClient.invalidateQueries({ queryKey: ['users'] });
      },
    }
  );
}

export function useUpdateUser() {
  return useApiMutation(
    ({ userId, data }: { userId: string; data: UpdateUserDto }) =>
      userApi.updateUser(userId, data),
    {
      onSuccess: (updatedUser) => {
        // Update cache optimistically
        queryClient.setQueryData(['users', updatedUser.userId], updatedUser);
        queryClient.invalidateQueries({ queryKey: ['users'] });
      },
    }
  );
}
```

---

## 4. Domain-Specific Implementation Examples

### User Management Forms

#### Create User Page

```typescript
// pages/users/CreateUserPage.tsx
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Container, Paper, Typography, Alert } from '@mui/material';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CreateUserDto, createUserSchema } from '@edforge/shared-types';
import { useCreateUser } from '../../hooks/useUsers';
import { UserForm } from '../../components/forms/UserForm';
import { handleApiError } from '../../utils/errorHandling';

export const CreateUserPage: React.FC = () => {
  const navigate = useNavigate();
  const createUser = useCreateUser();

  const handleSubmit = async (data: CreateUserDto) => {
    try {
      await createUser.mutateAsync(data);
      navigate('/users');
    } catch (error) {
      throw new Error(handleApiError(error));
    }
  };

  return (
    <Container maxWidth="md">
      <Paper sx={{ p: 3, mt: 3 }}>
        <Typography variant="h4" gutterBottom>
          Create New User
        </Typography>

        {createUser.error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {createUser.error.message}
          </Alert>
        )}

        <UserForm
          onSubmit={handleSubmit}
          loading={createUser.isPending}
          error={createUser.error?.message}
        />
      </Paper>
    </Container>
  );
};
```

#### User Profile Page with Preferences

```typescript
// pages/users/UserProfilePage.tsx
import React from 'react';
import { useParams } from 'react-router-dom';
import {
  Container,
  Paper,
  Typography,
  Tabs,
  Tab,
  Box,
  Alert,
} from '@mui/material';
import { useUser, useUpdateUser, useUserPreferences, useUpdatePreferences } from '../../hooks/useUsers';
import { UserForm } from '../../components/forms/UserForm';
import { PreferencesForm } from '../../components/forms/PreferencesForm';
import { handleApiError } from '../../utils/errorHandling';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel({ children, value, index, ...other }: TabPanelProps) {
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`user-tabpanel-${index}`}
      aria-labelledby={`user-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

export const UserProfilePage: React.FC = () => {
  const { userId } = useParams<{ userId: string }>();
  const [tabValue, setTabValue] = React.useState(0);

  const { data: user, isLoading: userLoading } = useUser(userId!);
  const { data: preferences, isLoading: prefsLoading } = useUserPreferences(userId!);
  const updateUser = useUpdateUser();
  const updatePreferences = useUpdatePreferences();

  const handleTabChange = (_: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const handleUpdateUser = async (data: UpdateUserDto) => {
    if (!userId) return;
    try {
      await updateUser.mutateAsync({ userId, data });
    } catch (error) {
      throw new Error(handleApiError(error));
    }
  };

  const handleUpdatePreferences = async (data: UpdatePreferencesDto) => {
    if (!userId) return;
    try {
      await updatePreferences.mutateAsync({ userId, data });
    } catch (error) {
      throw new Error(handleApiError(error));
    }
  };

  if (userLoading || prefsLoading) {
    return <div>Loading...</div>;
  }

  if (!user) {
    return <Alert severity="error">User not found</Alert>;
  }

  return (
    <Container maxWidth="md">
      <Paper sx={{ mt: 3 }}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs value={tabValue} onChange={handleTabChange}>
            <Tab label="Profile" />
            <Tab label="Preferences" />
            <Tab label="Security" />
          </Tabs>
        </Box>

        <TabPanel value={tabValue} index={0}>
          <Typography variant="h6" gutterBottom>
            User Information
          </Typography>
          {updateUser.error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {updateUser.error.message}
            </Alert>
          )}
          <UserForm
            user={user}
            onSubmit={handleUpdateUser}
            loading={updateUser.isPending}
            error={updateUser.error?.message}
          />
        </TabPanel>

        <TabPanel value={tabValue} index={1}>
          <Typography variant="h6" gutterBottom>
            User Preferences
          </Typography>
          {updatePreferences.error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {updatePreferences.error.message}
            </Alert>
          )}
          <PreferencesForm
            preferences={preferences}
            onSubmit={handleUpdatePreferences}
            loading={updatePreferences.isPending}
            error={updatePreferences.error?.message}
          />
        </TabPanel>

        <TabPanel value={tabValue} index={2}>
          <Typography variant="h6" gutterBottom>
            Security Settings
          </Typography>
          <SecuritySettings userId={userId} />
        </TabPanel>
      </Paper>
    </Container>
  );
};
```

### Student Management Forms

#### Create Student Form

```typescript
// components/forms/StudentForm.tsx
import React from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Button,
  TextField,
  Grid,
  Typography,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  IconButton,
  Alert,
} from '@mui/material';
import { ExpandMore, Add, Remove } from '@mui/icons-material';
import {
  createStudentSchema,
  CreateStudentDto,
  UpdateStudentDto,
  genderSchema,
  studentStatusSchema,
} from '@edforge/shared-types';
import { AddressForm } from './AddressForm';
import { GuardianForm } from './GuardianForm';
import { MedicalInfoForm } from './MedicalInfoForm';

interface StudentFormProps {
  student?: UpdateStudentDto;
  onSubmit: (data: CreateStudentDto | UpdateStudentDto) => Promise<void>;
  loading?: boolean;
  error?: string;
}

export const StudentForm: React.FC<StudentFormProps> = ({
  student,
  onSubmit,
  loading,
  error,
}) => {
  const schema = student ? createStudentSchema.partial().omit({ schoolId: true }) : createStudentSchema;
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
    watch,
  } = useForm<CreateStudentDto | UpdateStudentDto>({
    resolver: zodResolver(schema),
    defaultValues: student || {
      guardians: [{}], // Start with one empty guardian
    },
  });

  const { fields: guardianFields, append: appendGuardian, remove: removeGuardian } = useFieldArray({
    control,
    name: 'guardians',
  });

  const onFormSubmit = async (data: CreateStudentDto | UpdateStudentDto) => {
    try {
      await onSubmit(data);
    } catch (error) {
      // Error handled by parent
    }
  };

  const genderOptions = genderSchema._def.values;
  const statusOptions = studentStatusSchema._def.values;

  return (
    <form onSubmit={handleSubmit(onFormSubmit)}>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* Basic Information */}
      <Accordion defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Typography variant="h6">Basic Information</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField
                {...register('firstName')}
                label="First Name"
                error={!!errors.firstName}
                helperText={errors.firstName?.message}
                fullWidth
                required
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                {...register('lastName')}
                label="Last Name"
                error={!!errors.lastName}
                helperText={errors.lastName?.message}
                fullWidth
                required
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                {...register('middleName')}
                label="Middle Name"
                error={!!errors.middleName}
                helperText={errors.middleName?.message}
                fullWidth
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                {...register('preferredName')}
                label="Preferred Name"
                error={!!errors.preferredName}
                helperText={errors.preferredName?.message}
                fullWidth
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                {...register('dateOfBirth')}
                label="Date of Birth"
                type="date"
                error={!!errors.dateOfBirth}
                helperText={errors.dateOfBirth?.message}
                fullWidth
                required
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                {...register('gender')}
                label="Gender"
                select
                error={!!errors.gender}
                helperText={errors.gender?.message}
                fullWidth
                required
              >
                {genderOptions.map((option) => (
                  <MenuItem key={option} value={option}>
                    {option.charAt(0).toUpperCase() + option.slice(1)}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* Contact Information */}
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Typography variant="h6">Contact Information</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField
                {...register('contactInfo.email')}
                label="Email"
                type="email"
                error={!!errors.contactInfo?.email}
                helperText={errors.contactInfo?.email?.message}
                fullWidth
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                {...register('contactInfo.phone')}
                label="Phone"
                error={!!errors.contactInfo?.phone}
                helperText={errors.contactInfo?.phone?.message}
                fullWidth
              />
            </Grid>
          </Grid>
          <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
            Address
          </Typography>
          <AddressForm prefix="contactInfo.address." />
        </AccordionDetails>
      </Accordion>

      {/* Guardians */}
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Typography variant="h6">Guardians</Typography>
        </AccordionSummary>
        <AccordionDetails>
          {guardianFields.map((field, index) => (
            <Box key={field.id} sx={{ mb: 3, p: 2, border: '1px solid #e0e0e0', borderRadius: 1 }}>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="subtitle1">Guardian {index + 1}</Typography>
                {guardianFields.length > 1 && (
                  <IconButton onClick={() => removeGuardian(index)} color="error">
                    <Remove />
                  </IconButton>
                )}
              </Box>
              <GuardianForm prefix={`guardians.${index}.`} />
            </Box>
          ))}
          <Button
            startIcon={<Add />}
            onClick={() => appendGuardian({})}
            variant="outlined"
            fullWidth
          >
            Add Guardian
          </Button>
        </AccordionDetails>
      </Accordion>

      {/* Medical Information */}
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Typography variant="h6">Medical Information</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <MedicalInfoForm prefix="medicalInfo." />
        </AccordionDetails>
      </Accordion>

      {/* Submit */}
      <Box sx={{ mt: 3 }}>
        <Button
          type="submit"
          variant="contained"
          disabled={loading}
          fullWidth
        >
          {loading ? 'Saving...' : student ? 'Update Student' : 'Create Student'}
        </Button>
      </Box>
    </form>
  );
};
```

---

## 5. Best Practices

### Form Design

1. **Progressive Disclosure**: Use accordions/expandable sections for complex forms
2. **Field Dependencies**: Show/hide fields based on other field values
3. **Validation Feedback**: Real-time validation with clear error messages
4. **Loading States**: Disable forms and show progress during submission
5. **Optimistic Updates**: Update UI immediately, rollback on error

### API Integration

1. **Error Handling**: Centralized error handling with user-friendly messages
2. **Caching**: Use React Query for caching and background refetching
3. **Optimistic Updates**: Update UI immediately, handle rollback on failure
4. **Background Sync**: Automatically refetch data in background
5. **Request Deduplication**: Avoid duplicate requests with the same parameters

### Schema Design

1. **Reusability**: Create reusable sub-schemas (Address, Contact, etc.)
2. **Extensibility**: Use `.extend()` and `.merge()` for variations
3. **Validation**: Prefer descriptive error messages over generic ones
4. **Type Safety**: Leverage TypeScript inference from Zod schemas
5. **Versioning**: Plan for schema evolution with backward compatibility

### Performance

1. **Lazy Loading**: Load form components only when needed
2. **Debounced Validation**: Avoid excessive validation calls
3. **Pagination**: Use cursor-based pagination for large datasets
4. **Virtual Scrolling**: For very large lists
5. **Bundle Splitting**: Split forms into separate chunks

### Security

1. **Input Sanitization**: Rely on Zod schemas for validation
2. **CSRF Protection**: Include CSRF tokens when required
3. **Rate Limiting**: Handle API rate limits gracefully
4. **Data Masking**: Mask sensitive data in logs and UI
5. **Permission Checks**: Validate user permissions before showing forms

---

## 6. Migration from Legacy Forms

### Common Issues to Address

1. **Schema Alignment**: Ensure frontend and backend schemas match exactly
2. **Validation Consistency**: Use same validation rules across all forms
3. **Error Handling**: Standardize error messages and handling patterns
4. **Loading States**: Implement consistent loading and disabled states
5. **Accessibility**: Ensure forms are accessible with proper labels and ARIA attributes

### Migration Steps

1. **Audit Existing Forms**: Document all current form fields and validation rules
2. **Create Zod Schemas**: Convert existing DTOs to Zod schemas in shared-types
3. **Update Backend**: Replace class-validator with Zod schemas
4. **Update Frontend**: Replace manual validation with Zod + react-hook-form
5. **Test Integration**: Ensure end-to-end functionality works
6. **Migrate Components**: Update one form at a time to minimize risk

This guide provides a comprehensive foundation for implementing forms and API integration in EdForge using the Zod schema-first approach. The patterns shown ensure type safety, consistent validation, and maintainable code across the entire application.