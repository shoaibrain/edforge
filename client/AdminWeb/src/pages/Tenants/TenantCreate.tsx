import React, { useState, useCallback } from "react";
import {
  Typography,
  Card,
  CardContent,
  TextField,
  Button,
  Alert,
  Grid,
  FormControlLabel,
  Switch,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Checkbox,
} from "@mui/material";
import PublicIcon from "@mui/icons-material/Public";
import { useNavigate } from "react-router-dom";
import { v4 as uuid } from "uuid";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AddIcon from "@mui/icons-material/Add";
import BusinessIcon from "@mui/icons-material/Business";
import PeopleIcon from "@mui/icons-material/People";
import FlashOnIcon from "@mui/icons-material/FlashOn";
import EmailIcon from "@mui/icons-material/Email";
import { CreateTenantRequest } from "../../models/tenant";
import tenantService from "../../services/tenantService";
import { useAuth } from "../../contexts/AuthContext";
import { handleApiError } from "../../types/errors";
import { PRICING_PLANS } from "../../constants/pricing";
import { TENANT_DEFAULTS, TENANT_TAG_OPTIONS } from "../../constants/tenant";
// COUNTRY_OPTIONS + ARCHETYPE_OPTIONS come from @aibrains/shared-types
// (moved from the workspace-only @edforge/tenant-locale-defaults in 0.26.0
// so AdminWeb's CodeBuild `npm install` can resolve from the npm registry;
// the workspace-only package was unpublishable).
// `TENANT_COUNTRY_OPTIONS` is the richer version with `.info` field used
// by the country dropdown below; aliased back to `COUNTRY_OPTIONS` for the
// existing call-sites.
import {
  ARCHETYPE_OPTIONS,
  TENANT_COUNTRY_OPTIONS as COUNTRY_OPTIONS,
} from "@aibrains/shared-types";
import type { ActiveArchetype, TenantTag } from "@aibrains/shared-types";
import "../../styles/index.css";

interface FormData {
  tenantName: string;
  email: string;
  country: string;
  archetype: ActiveArchetype;
  tenantTag: TenantTag;
  /**
   * Set true when the operator picks tenantTag='production' AND ticks the
   * "I understand" checkbox in the inline confirmation gate. Production-tag
   * submissions are blocked until this is true.
   */
  productionTagConfirmed: boolean;
  tier: string;
  useFederation: boolean;
  useEc2: boolean;
  useRProxy: boolean;
}

const TenantCreate: React.FC = () => {
  const [formData, setFormData] = useState<FormData>({
    tenantName: "",
    email: "",
    country: "",
    archetype: "GENERIC",
    // Default to internal-dev so the operator's day-to-day case (R&D against a
    // dev tenant) is the natural top-of-form pick. Choosing 'production' is
    // gated by the inline confirmation below — see TENANT_TAG_OPTIONS.
    tenantTag: TENANT_DEFAULTS.DEFAULT_TENANT_TAG,
    productionTagConfirmed: false,
    // V1_DEFERRED: Default was "ADVANCED". Restore when Advanced tier provisioning is production-ready.
    tier: "BASIC",
    useFederation: false,
    useEc2: false,
    useRProxy: true,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [validationErrors, setValidationErrors] = useState<{
    [key: string]: string;
  }>({});
  const navigate = useNavigate();
  const { user } = useAuth();

  const validateTenantName = (name: string): string | null => {
    if (!name) return "Tenant name is required";
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      return "Must start with a lowercase letter, and only contain lowercase letters, numbers, and hyphens";
    }
    return null;
  };

  const validateEmail = (email: string): string | null => {
    if (!email) return "Email is required";
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return "Please enter a valid email address";
    return null;
  };

  const handleEmailBlur = () => {
    const emailError = validateEmail(formData.email);
    if (emailError) {
      setValidationErrors((prev) => ({
        ...prev,
        email: emailError,
      }));
    } else {
      setValidationErrors((prev) => ({
        ...prev,
        email: "",
      }));
    }
  };

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
          field === "useRProxy" ||
          field === "productionTagConfirmed"
            ? event.target.checked
            : event.target.value;

        setFormData((prev) => ({
          ...prev,
          [field]: value,
        }));

        // Clear validation error when user starts typing
        if (validationErrors[field]) {
          setValidationErrors((prev) => ({
            ...prev,
            [field]: "",
          }));
        }

        // Switching tenantTag away from 'production' clears the confirmation
        // ticking — operator must re-confirm if they pick 'production' again.
        if (field === "tenantTag" && value !== "production") {
          setFormData((prev) => ({ ...prev, productionTagConfirmed: false }));
          setValidationErrors((prev) => ({ ...prev, productionTagConfirmed: "" }));
        }

        // Handle federation and EC2 control based on tier
        if (field === "tier") {
          if (value !== "ADVANCED" && value !== "PREMIUM") {
            setFormData((prev) => ({
              ...prev,
              useFederation: false,
            }));
          }
          if (value !== "PREMIUM") {
            setFormData((prev) => ({
              ...prev,
              useEc2: false,
            }));
          }
        }
      },
    [validationErrors]
  );

  const validateForm = useCallback((): boolean => {
    const errors: { [key: string]: string } = {};

    const tenantNameError = validateTenantName(formData.tenantName);
    if (tenantNameError) errors.tenantName = tenantNameError;

    const emailError = validateEmail(formData.email);
    if (emailError) errors.email = emailError;

    if (!formData.country) errors.country = "Country / Region is required";

    if (!formData.archetype) errors.archetype = "Archetype is required";

    if (!formData.tier) errors.tier = "Tier is required";

    // Production-tag gate: tenantTag is immutable after provisioning, and a
    // production tenant cannot be deleted from this UI. Force a deliberate
    // confirmation so picking the wrong tag is hard to do by accident.
    if (formData.tenantTag === "production" && !formData.productionTagConfirmed) {
      errors.productionTagConfirmed =
        "Confirm you understand: this tag is immutable and the tenant cannot be deleted from this UI.";
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  }, [
    formData.tenantName,
    formData.email,
    formData.country,
    formData.archetype,
    formData.tenantTag,
    formData.productionTagConfirmed,
    formData.tier,
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // Add authentication check
    if (!user || !user.access_token) {
      setError("Authentication required. Please log in again.");
      return;
    }

    if (!validateForm()) {
      return;
    }

    setLoading(true);

    try {
      const tenant: CreateTenantRequest = {
        tenantId: uuid(),
        tenantData: {
          tenantName: formData.tenantName,
          email: formData.email,
          tier: formData.tier,
          country: formData.country !== "OTHER" ? formData.country : undefined,
          archetype: formData.archetype,
          tenantTag: formData.tenantTag,
          prices: [],
          // V1_DEFERRED: Hardcoded to safe Basic tier defaults. Restore formData values when Advanced/Premium supported.
          useFederation: "false",
          useEc2: "false",
          useRProxy: "true",
        },
        tenantRegistrationData: {
          registrationStatus: TENANT_DEFAULTS.REGISTRATION_STATUS,
        },
      };

      await tenantService.createTenant(tenant);
      navigate("/tenants");
    } catch (error: any) {
      setError(handleApiError(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="tenant-create-container">
      <div className="tenant-create-content">
        {/* Header with Back Button */}
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={useCallback(() => navigate("/tenants"), [navigate])}
          className="tenant-back-button"
        >
          Back to Tenants
        </Button>

        <Grid container spacing={3}>
          {/* Main Form */}
          <Grid item xs={12} lg={9}>
            <Card className="tenant-glass-card">
              <CardContent className="tenant-main-card">
                <div className="page-header">
                  <AddIcon className="tenant-page-icon" />
                  <Typography variant="h4" className="page-title">
                    Onboard New Tenant
                  </Typography>
                </div>
                <Typography variant="body2" className="page-subtitle">
                  Set up a new tenant organization with automated infrastructure
                  provisioning
                </Typography>

                {error && (
                  <Alert severity="error" className="custom-alert">
                    {error}
                  </Alert>
                )}

                <form onSubmit={handleSubmit}>
                  {/* Tenant Name */}
                  <div className="form-section">
                    <label className="form-label">
                      Tenant Name <span className="required-asterisk">*</span>
                    </label>
                    <TextField
                      fullWidth
                      placeholder="Enter tenant name"
                      value={formData.tenantName}
                      onChange={handleChange("tenantName")}
                      error={!!validationErrors.tenantName}
                      helperText={validationErrors.tenantName}
                      required
                      className="custom-input"
                    />
                  </div>

                  {/* Institution Name - Not used for now */}
                  {/* <div className="form-section">
                    <label className="form-label">
                      Institution Name{" "}
                      <span className="required-asterisk">*</span>
                    </label>
                    <TextField
                      fullWidth
                      placeholder="Enter institution name"
                      value={formData.tenantName}
                      onChange={handleChange("tenantName")}
                      error={!!validationErrors.tenantName}
                      helperText={validationErrors.tenantName}
                      required
                      className="custom-input"
                    />
                  </div> */}

                  {/* Administrator Email */}
                  <div className="form-section">
                    <label className="form-label">
                      Administrator Email{" "}
                      <span className="required-asterisk">*</span>
                    </label>
                    <TextField
                      fullWidth
                      type="email"
                      placeholder="admin@company.com"
                      value={formData.email}
                      onChange={handleChange("email")}
                      onBlur={handleEmailBlur}
                      error={!!validationErrors.email}
                      helperText={validationErrors.email}
                      required
                      className="custom-input"
                    />
                  </div>

                  {/* Tenant Tag — lifecycle classification (immutable after provisioning) */}
                  <div className="form-section">
                    <label className="form-label">
                      Tenant Tag <span className="required-asterisk">*</span>
                    </label>
                    <FormControl fullWidth className="custom-input">
                      <Select
                        value={formData.tenantTag}
                        onChange={(e) =>
                          handleChange("tenantTag")({
                            target: { value: e.target.value as string },
                          })
                        }
                      >
                        {TENANT_TAG_OPTIONS.map((opt) => (
                          <MenuItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    {(() => {
                      const opt = TENANT_TAG_OPTIONS.find((o) => o.value === formData.tenantTag);
                      return opt ? (
                        <Alert severity={opt.variant} sx={{ mt: 1 }}>
                          {opt.description}
                        </Alert>
                      ) : null;
                    })()}
                    {formData.tenantTag === "production" && (
                      <>
                        <Alert severity="warning" sx={{ mt: 1 }}>
                          <strong>Heads up:</strong> tenantTag is immutable. Once this
                          tenant is created as <code>production</code>, it cannot be
                          deleted from AdminWeb — removal requires CLI ceremony with
                          extra IAM. Confirm before continuing.
                        </Alert>
                        <FormControlLabel
                          sx={{ mt: 1 }}
                          control={
                            <Checkbox
                              checked={formData.productionTagConfirmed}
                              onChange={handleChange("productionTagConfirmed")}
                            />
                          }
                          label="I understand the tag is immutable and this tenant will not be deletable from this UI."
                        />
                        {validationErrors.productionTagConfirmed && (
                          <Typography
                            variant="caption"
                            color="error"
                            className="tenant-validation-error"
                            sx={{ display: "block" }}
                          >
                            {validationErrors.productionTagConfirmed}
                          </Typography>
                        )}
                      </>
                    )}
                  </div>

                  {/* Country / Region */}
                  <div className="form-section">
                    <label className="form-label">
                      Country / Region <span className="required-asterisk">*</span>
                    </label>
                    <FormControl fullWidth error={!!validationErrors.country} className="custom-input">
                      <Select
                        value={formData.country}
                        onChange={(e) =>
                          handleChange("country")({
                            target: { value: e.target.value as string },
                          })
                        }
                        displayEmpty
                        startAdornment={<PublicIcon sx={{ mr: 1, color: 'text.secondary' }} />}
                      >
                        <MenuItem value="" disabled>
                          Select country / region
                        </MenuItem>
                        {COUNTRY_OPTIONS.map((opt) => (
                          <MenuItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    {validationErrors.country && (
                      <Typography
                        variant="caption"
                        color="error"
                        className="tenant-validation-error"
                      >
                        {validationErrors.country}
                      </Typography>
                    )}
                    {formData.country && (
                      <Alert severity="info" sx={{ mt: 1 }}>
                        {COUNTRY_OPTIONS.find((o) => o.value === formData.country)?.info}
                      </Alert>
                    )}
                  </div>

                  {/* Archetype — umbrella operational pattern (immutable after provisioning) */}
                  <div className="form-section">
                    <label className="form-label">
                      Archetype <span className="required-asterisk">*</span>
                    </label>
                    <FormControl fullWidth error={!!validationErrors.archetype} className="custom-input">
                      <Select
                        value={formData.archetype}
                        onChange={(e) =>
                          handleChange("archetype")({
                            target: { value: e.target.value as string },
                          })
                        }
                        displayEmpty
                      >
                        {ARCHETYPE_OPTIONS.map((opt) => (
                          <MenuItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    {validationErrors.archetype && (
                      <Typography
                        variant="caption"
                        color="error"
                        className="tenant-validation-error"
                      >
                        {validationErrors.archetype}
                      </Typography>
                    )}
                    {formData.archetype && (
                      <Alert severity="info" sx={{ mt: 1 }}>
                        {ARCHETYPE_OPTIONS.find((o) => o.value === formData.archetype)?.info}
                      </Alert>
                    )}
                  </div>

                  {/* Tier Selection */}
                  <div className="form-section">
                    <label className="form-label">
                      Tier <span className="required-asterisk">*</span>
                    </label>

                    {/* V1_DEFERRED: Advanced and Premium tier selection disabled for MVP.
                        To re-enable:
                        1. Fix CDK Nag errors in tenant-template-stack for silo deployment
                        2. Fix table naming mismatch in TenantSeeder Lambda (hardcoded vs per-tenant table names)
                        3. Resolve SBT ISSUE-008 (Step Functions masking CodeBuild failures)
                        4. Re-enable these cards by removing the disabled logic below */}
                    <Grid container spacing={2}>
                      {Object.values(PRICING_PLANS).map((plan) => {
                        const isDisabled = plan.id !== "BASIC";
                        return (
                          <Grid item xs={12} md={4} key={plan.id}>
                            <Card
                              className={`tenant-plan-card ${
                                formData.tier === plan.id ? "selected" : ""
                              }`}
                              onClick={() => {
                                if (!isDisabled) {
                                  handleChange("tier")({
                                    target: { value: plan.id },
                                  });
                                }
                              }}
                              sx={{
                                ...(isDisabled && {
                                  opacity: 0.6,
                                  cursor: "not-allowed",
                                  position: "relative",
                                }),
                              }}
                            >
                              <div className="plan-header">
                                <Typography variant="h6" className="plan-title">
                                  {plan.name}
                                </Typography>
                                <Typography
                                  variant="body2"
                                  className="plan-price"
                                >
                                  ${plan.price}/month
                                </Typography>
                              </div>
                              <Typography
                                variant="body2"
                                className="plan-description"
                              >
                                {plan.description}
                              </Typography>
                              {isDisabled && (
                                <Chip
                                  label="Coming Soon"
                                  size="small"
                                  color="info"
                                  sx={{ mt: 1 }}
                                />
                              )}
                            </Card>
                          </Grid>
                        );
                      })}
                    </Grid>

                    {validationErrors.tier && (
                      <Typography
                        variant="caption"
                        color="error"
                        className="tenant-validation-error"
                      >
                        {validationErrors.tier}
                      </Typography>
                    )}
                  </div>

                  {/* V1_DEFERRED: Configuration switches (Federation, EC2, Reverse Proxy) are
                      Advanced/Premium-only features. Hardcoded to safe defaults for Basic tier:
                      useFederation=false, useEc2=false, useRProxy=true.
                      To re-enable: Remove disabled prop when Advanced/Premium tiers are supported. */}
                  {/* Configuration Options */}
                  <div className="form-section">
                    <label className="form-label">Configuration Options</label>

                    <div className="config-switches-row">
                      <div className="config-switch-item">
                        <FormControlLabel
                          control={
                            <Switch
                              checked={formData.useFederation}
                              onChange={handleChange("useFederation")}
                              disabled
                            />
                          }
                          label="Use Federation"
                        />
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          className="config-description"
                        >
                          Advanced/Premium only (Coming Soon)
                        </Typography>
                      </div>

                      <div className="config-switch-item">
                        <FormControlLabel
                          control={
                            <Switch
                              checked={formData.useRProxy}
                              onChange={handleChange("useRProxy")}
                              disabled
                            />
                          }
                          label="Use Reverse Proxy"
                        />
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          className="config-description"
                        >
                          Enable request routing proxy
                        </Typography>
                      </div>

                      <div className="config-switch-item">
                        <FormControlLabel
                          control={
                            <Switch
                              checked={formData.useEc2}
                              onChange={handleChange("useEc2")}
                              disabled
                            />
                          }
                          label="Use EC2"
                        />
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          className="config-description"
                        >
                          Premium only (Coming Soon)
                        </Typography>
                      </div>
                    </div>
                  </div>

                  {/* Submit Button */}
                  <Button
                    type="submit"
                    fullWidth
                    disabled={loading}
                    className="tenant-submit-button"
                  >
                    <AddIcon className="tenant-submit-icon" />
                    {loading ? "Creating Tenant..." : "Create Tenant"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </Grid>

          {/* Sidebar */}
          <Grid item xs={12} lg={3}>
            <Card className="tenant-glass-card">
              <CardContent className="tenant-sidebar-card">
                <div className="page-header">
                  <BusinessIcon className="tenant-sidebar-icon" />
                  <Typography variant="h5" className="page-title">
                    Tenant Preview
                  </Typography>
                </div>
                <Typography variant="body2" className="page-subtitle">
                  Review the tenant information to be created
                </Typography>

                <div>
                  <div className="feature-item">
                    <PeopleIcon className="feature-icon" />
                    <Typography variant="body2" className="feature-text">
                      User Management
                    </Typography>
                  </div>
                  <div className="feature-item">
                    <FlashOnIcon className="feature-icon" />
                    <Typography variant="body2" className="feature-text">
                      Auto Provisioning
                    </Typography>
                  </div>
                  <div className="feature-item">
                    <EmailIcon className="feature-icon" />
                    <Typography variant="body2" className="feature-text">
                      Administrator Invitation
                    </Typography>
                  </div>
                </div>

                <div className="sidebar-divider">
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    className="tenant-sidebar-caption"
                  >
                    The following resources will be automatically provisioned
                    after tenant creation:
                  </Typography>
                  <ul className="provision-list">
                    <li className="provision-item">DynamoDB Tables</li>
                    <li className="provision-item">Cognito User Pool</li>
                    <li className="provision-item">Tenant Service Setting</li>
                    <li className="provision-item">
                      Tenant Routing Configuration
                    </li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </div>
    </div>
  );
};

export default TenantCreate;
