import React, { useState, useEffect, useCallback } from "react";
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Grid,
  Alert,
  Chip,
  CircularProgress,
} from "@mui/material";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import {
  Delete as DeleteIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Schedule as ScheduleIcon,
  Sync as SyncIcon,
  Cancel as CancelIcon,
  HelpOutline as HelpOutlineIcon,
  Public as PublicIcon,
  Settings as SettingsIcon,
  ArrowBack as ArrowBackIcon,
} from "@mui/icons-material";
import { Tenant, TenantRegistrationData } from "../../models/tenant";
import tenantService from "../../services/tenantService";
import DeleteTenantDialog from "../../components/DeleteTenantDialog";
import { TIER_COLORS } from "../../constants/pricing";
import { TENANT_TAG_OPTIONS } from "../../constants/tenant";
import type { TenantTag } from "@aibrains/shared-types";
import "../../styles/pages/tenant-detail.css";

const TENANT_TAG_CHIP_COLOR: Record<TenantTag, "success" | "info" | "warning"> = {
  production: "success",
  "internal-dev": "info",
  "internal-dev-rehearsal": "warning",
};

const COUNTRY_SETTINGS: Record<string, { label: string; currency: string; calendar: string; timezone: string; locale: string; numberFormat: string }> = {
  NPL: { label: "Nepal", currency: "NPR", calendar: "Bikram Sambat", timezone: "Asia/Kathmandu", locale: "ne-NP", numberFormat: "South Asian" },
  USA: { label: "United States", currency: "USD", calendar: "Gregorian", timezone: "America/New_York", locale: "en-US", numberFormat: "International" },
  IND: { label: "India", currency: "INR", calendar: "Gregorian", timezone: "Asia/Kolkata", locale: "en-IN", numberFormat: "South Asian" },
};
const DEFAULT_SETTINGS = COUNTRY_SETTINGS.USA;

// Consolidated tenant state combining API + navigation data
interface TenantState {
  tenantName: string;
  email: string;
  tier: string;
  country: string;
  /**
   * Lifecycle classification — defaults to 'production' when absent
   * (Saraswati invariant: pre-Sprint-1 tenants get backfilled to production).
   */
  tenantTag: TenantTag;
  useFederation: string;
  useEc2: string;
  useRProxy: string;
  tenantRegistrationId: string;
  registrationStatus: string;
  sbtaws_active: boolean;
}

function extractTenantState(
  id: string,
  locationState: any,
  fullTenant: Tenant | null,
  registrationData: TenantRegistrationData | null
): TenantState {
  // Priority: fullTenant (from API, normalized) > locationState (from navigation)
  // Also handle flat API responses as fallback (fullTenant may have flat fields)
  const td = fullTenant?.tenantData;
  const rd = fullTenant?.tenantRegistrationData;
  const ft = fullTenant as any;

  return {
    tenantName: td?.tenantName || ft?.tenantName || locationState?.tenantName || "N/A",
    email: td?.email || ft?.email || locationState?.email || "N/A",
    tier: td?.tier || ft?.tier || locationState?.tier || "unknown",
    country: td?.country || ft?.country || locationState?.country || "",
    tenantTag:
      ((td?.tenantTag || ft?.tenantTag || locationState?.tenantTag) as TenantTag | undefined) ??
      "production",
    useFederation: td?.useFederation || ft?.useFederation || locationState?.useFederation || "",
    useEc2: td?.useEc2 || ft?.useEc2 || locationState?.useEc2 || "",
    useRProxy: td?.useRProxy || ft?.useRProxy || locationState?.useRProxy || "",
    tenantRegistrationId:
      registrationData?.tenantRegistrationId ||
      rd?.tenantRegistrationId ||
      ft?.tenantRegistrationId ||
      locationState?.tenantRegistrationId ||
      id,
    registrationStatus:
      registrationData?.registrationStatus ||
      rd?.registrationStatus ||
      ft?.registrationStatus ||
      locationState?.registrationStatus ||
      "",
    sbtaws_active:
      fullTenant?.sbtaws_active !== undefined
        ? fullTenant.sbtaws_active !== false
        : locationState?.sbtaws_active !== false,
  };
}

const TenantDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [registrationData, setRegistrationData] = useState<TenantRegistrationData | null>(null);
  const [fullTenant, setFullTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchTenantData = useCallback(async (tenantId: string) => {
    try {
      setLoading(true);
      setError(null);

      const tenantRegistrationId =
        location.state?.tenantRegistrationId || tenantId;

      // Always fetch registration data (lightweight)
      const regData = await tenantService.getTenant(tenantRegistrationId);
      setRegistrationData(regData);

      // If no navigation state, also fetch full tenant data for config details
      if (!location.state?.tenantName) {
        const tenant = await tenantService.fetchTenantById(tenantId);
        setFullTenant(tenant);
      }
    } catch (err: any) {
      setError(err.message || "Failed to fetch tenant details");
    } finally {
      setLoading(false);
    }
  }, [location.state?.tenantRegistrationId, location.state?.tenantName]);

  useEffect(() => {
    if (id) {
      fetchTenantData(id);
    }
  }, [fetchTenantData, id]);

  const ts = extractTenantState(id || "", location.state, fullTenant, registrationData);

  const getStatusInfo = (status: string) => {
    const statusLower = status?.toLowerCase() || "";

    switch (statusLower) {
      case "complete":
      case "created":
      case "active":
        return {
          className: "status-badge--success",
          icon: <CheckCircleIcon className="status-badge__icon" />,
          label:
            statusLower === "created"
              ? "Created"
              : statusLower === "active"
              ? "Active"
              : "Complete",
        };
      case "failed":
      case "error":
        return {
          className: "status-badge--error",
          icon: <ErrorIcon className="status-badge__icon" />,
          label: statusLower === "failed" ? "Failed" : "Error",
        };
      case "deleted":
        return {
          className: "status-badge--error",
          icon: <CancelIcon className="status-badge__icon" />,
          label: "Deleted",
        };
      case "in progress":
      case "inprogress":
      case "provisioning":
      case "processing":
        return {
          className: "status-badge--info",
          icon: <SyncIcon className="status-badge__icon status-badge__icon--spinning" />,
          label:
            statusLower === "provisioning"
              ? "Provisioning"
              : statusLower === "processing"
              ? "Processing"
              : "In Progress",
        };
      case "pending":
      case "waiting":
        return {
          className: "status-badge--warning",
          icon: <ScheduleIcon className="status-badge__icon" />,
          label: statusLower === "waiting" ? "Waiting" : "Pending",
        };
      case "cancelled":
      case "canceled":
        return {
          className: "status-badge--default",
          icon: <CancelIcon className="status-badge__icon" />,
          label: "Cancelled",
        };
      default:
        return {
          className: "status-badge--default",
          icon: <HelpOutlineIcon className="status-badge__icon" />,
          label: status || "Unknown",
        };
    }
  };

  const handleDelete = async () => {
    if (!registrationData || !id) return;

    try {
      setDeleting(true);
      setError(null);

      const tenantToDelete = {
        tenantId: id,
        tenantData: {
          tenantName: ts.tenantName,
          email: ts.email,
          tier: ts.tier,
        },
        tenantRegistrationData: {
          tenantRegistrationId: registrationData.tenantRegistrationId,
          registrationStatus: registrationData.registrationStatus,
        },
      };

      await tenantService.deleteTenant(tenantToDelete);
      navigate("/tenants");
    } catch (err: any) {
      setError(
        `Failed to delete tenant: ${err.message}`
      );
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  };

  const boolLabel = (val: string) => {
    if (!val) return "N/A";
    return val.toLowerCase() === "true" ? "Yes" : "No";
  };

  if (loading) {
    return (
      <Box className="loading-container">
        <CircularProgress />
      </Box>
    );
  }

  if (error && !registrationData && !fullTenant) {
    return (
      <Box>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => navigate("/tenants")}>
              Back to Tenants
            </Button>
          }
        >
          {error}
        </Alert>
      </Box>
    );
  }

  return (
    <>
      <div className="page-container">
        <div className="container">
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              mb: 2,
            }}
          >
            <div>
              <Typography variant="h4" className="page-title">
                Tenant Details
              </Typography>
              <Typography variant="body2" className="page-subtitle">
                View and manage tenant registration information
              </Typography>
            </div>
            <Box sx={{ display: "flex", gap: 1 }}>
              <Button
                variant="outlined"
                startIcon={<ArrowBackIcon />}
                onClick={() => navigate("/tenants")}
                size="small"
              >
                Back
              </Button>
              <Button
                variant="contained"
                startIcon={<DeleteIcon />}
                onClick={() => setDeleteDialogOpen(true)}
                disabled={deleting || !ts.sbtaws_active}
                className="delete-tenant-button"
              >
                Delete Tenant
              </Button>
            </Box>
          </Box>

          {/* Active/Inactive Status Banner */}
          <Box sx={{ mb: 3 }}>
            {ts.sbtaws_active ? (
              <Alert severity="success" variant="outlined">
                This tenant is active
              </Alert>
            ) : (
              <Alert severity="warning" variant="outlined">
                This tenant has been deactivated
              </Alert>
            )}
          </Box>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          <Grid container spacing={3}>
            {/* Registration Information */}
            <Grid item xs={12}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Tenant Registration Information
                  </Typography>

                  <Box className="tenant-detail-field">
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      className="tenant-detail-field-label"
                    >
                      Tenant Name
                    </Typography>
                    <Typography
                      variant="h6"
                      className="tenant-detail-field-value"
                    >
                      {ts.tenantName}
                    </Typography>
                  </Box>

                  <Box className="tenant-detail-field">
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      className="tenant-detail-field-label"
                    >
                      Registration ID
                    </Typography>
                    <Typography
                      variant="body1"
                      className="tenant-detail-id-field"
                    >
                      {ts.tenantRegistrationId || "N/A"}
                    </Typography>
                  </Box>

                  <Box className="tenant-detail-field">
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mb: 1 }}
                    >
                      Registration Status
                    </Typography>
                    <div className={`status-badge ${getStatusInfo(ts.registrationStatus).className}`}>
                      {getStatusInfo(ts.registrationStatus).icon}
                      {getStatusInfo(ts.registrationStatus).label}
                    </div>
                  </Box>

                  <Box className="tenant-detail-field">
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      className="tenant-detail-field-label"
                    >
                      Tenant ID
                    </Typography>
                    <Typography
                      variant="body1"
                      className="tenant-detail-id-field"
                    >
                      {id}
                    </Typography>
                  </Box>
                </CardContent>
              </Card>
            </Grid>

            {/* Tenant Configuration */}
            <Grid item xs={12}>
              <Card>
                <CardContent>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
                    <SettingsIcon color="primary" />
                    <Typography variant="h6">
                      Tenant Configuration
                    </Typography>
                  </Box>

                  <Box className="tenant-detail-field">
                    <Typography variant="body2" color="text.secondary" className="tenant-detail-field-label">
                      Lifecycle Tag
                    </Typography>
                    <Chip
                      label={
                        TENANT_TAG_OPTIONS.find((o) => o.value === ts.tenantTag)?.label ??
                        ts.tenantTag
                      }
                      color={TENANT_TAG_CHIP_COLOR[ts.tenantTag]}
                      size="small"
                      variant={ts.tenantTag === "production" ? "filled" : "outlined"}
                    />
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block", mt: 0.5 }}
                    >
                      Immutable. Set at provisioning;{" "}
                      {ts.tenantTag === "production"
                        ? "this tenant cannot be deleted from this UI."
                        : "deletable from this UI when needed."}
                    </Typography>
                  </Box>

                  <Box className="tenant-detail-field">
                    <Typography variant="body2" color="text.secondary" className="tenant-detail-field-label">
                      Tier
                    </Typography>
                    <Chip
                      label={ts.tier.toUpperCase()}
                      color={TIER_COLORS[ts.tier.toLowerCase() as keyof typeof TIER_COLORS] as any || "default"}
                      size="small"
                    />
                  </Box>

                  <Box className="tenant-detail-field">
                    <Typography variant="body2" color="text.secondary" className="tenant-detail-field-label">
                      Admin Email
                    </Typography>
                    <Typography variant="body1">
                      {ts.email}
                    </Typography>
                  </Box>

                  <Box className="tenant-detail-field">
                    <Typography variant="body2" color="text.secondary" className="tenant-detail-field-label">
                      Country / Region
                    </Typography>
                    <Typography variant="body1">
                      {ts.country ? (COUNTRY_SETTINGS[ts.country]?.label || ts.country) : "N/A"}
                    </Typography>
                  </Box>

                  <Box className="tenant-detail-field">
                    <Typography variant="body2" color="text.secondary" className="tenant-detail-field-label">
                      Use Federation
                    </Typography>
                    <Typography variant="body1">
                      {boolLabel(ts.useFederation)}
                    </Typography>
                  </Box>

                  <Box className="tenant-detail-field">
                    <Typography variant="body2" color="text.secondary" className="tenant-detail-field-label">
                      Use EC2
                    </Typography>
                    <Typography variant="body1">
                      {boolLabel(ts.useEc2)}
                    </Typography>
                  </Box>

                  <Box className="tenant-detail-field">
                    <Typography variant="body2" color="text.secondary" className="tenant-detail-field-label">
                      Use Reverse Proxy
                    </Typography>
                    <Typography variant="body1">
                      {boolLabel(ts.useRProxy)}
                    </Typography>
                  </Box>
                </CardContent>
              </Card>
            </Grid>

            {/* Regional Settings Card */}
            <Grid item xs={12}>
              <Card>
                <CardContent>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
                    <PublicIcon color="primary" />
                    <Typography variant="h6">
                      Regional Settings
                    </Typography>
                  </Box>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Auto-configured during provisioning based on country selection.
                    Tenant admin can modify these in Settings &rarr; Workspace after login.
                  </Typography>

                  {(() => {
                    const settings = ts.country ? (COUNTRY_SETTINGS[ts.country] || DEFAULT_SETTINGS) : DEFAULT_SETTINGS;
                    return (
                      <>
                        {[
                          { label: "Country", value: settings.label },
                          { label: "Currency", value: settings.currency },
                          { label: "Calendar System", value: settings.calendar },
                          { label: "Timezone", value: settings.timezone },
                          { label: "Locale", value: settings.locale },
                          { label: "Number Format", value: settings.numberFormat },
                        ].map((row) => (
                          <Box key={row.label} className="tenant-detail-field">
                            <Typography variant="body2" color="text.secondary" className="tenant-detail-field-label">
                              {row.label}
                            </Typography>
                            <Typography variant="body1">
                              {row.value}
                            </Typography>
                          </Box>
                        ))}
                      </>
                    );
                  })()}
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </div>
      </div>

      <DeleteTenantDialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={handleDelete}
        isDeleting={deleting}
      />
    </>
  );
};

export default TenantDetail;
