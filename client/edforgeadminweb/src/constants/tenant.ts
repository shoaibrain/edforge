export const TENANT_DEFAULTS = {
  REGISTRATION_STATUS: "Created",
  USE_FEDERATION: false,
  USE_EC2: false,
  USE_RPROXY: true,
} as const

export const TENANT_VALIDATION = {
  NAME_REGEX: /^[a-z][a-z0-9-]*$/,
  EMAIL_REGEX: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
} as const
