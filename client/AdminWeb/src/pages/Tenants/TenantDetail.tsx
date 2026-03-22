import React, { useState, useEffect, useCallback } from "react";
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Grid,
  Alert,
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
} from "@mui/icons-material";
import { TenantRegistrationData } from "../../models/tenant";
import tenantService from "../../services/tenantService";
import DeleteTenantDialog from "../../components/DeleteTenantDialog";
import "../../styles/pages/tenant-detail.css";

const COUNTRY_SETTINGS: Record<string, { label: string; currency: string; calendar: string; timezone: string; locale: string; numberFormat: string }> = {
  NPL: { label: "Nepal", currency: "NPR", calendar: "Bikram Sambat", timezone: "Asia/Kathmandu", locale: "ne-NP", numberFormat: "South Asian" },
  USA: { label: "United States", currency: "USD", calendar: "Gregorian", timezone: "America/New_York", locale: "en-US", numberFormat: "International" },
  IND: { label: "India", currency: "INR", calendar: "Gregorian", timezone: "Asia/Kolkata", locale: "en-IN", numberFormat: "South Asian" },
};
const DEFAULT_SETTINGS = COUNTRY_SETTINGS.USA;

const TenantDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [tenant, setTenant] = useState<TenantRegistrationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchTenant = useCallback(async (tenantId: string) => {
    try {
      setLoading(true);
      setError(null);

      // Use tenantRegistrationId from navigation state if available
      const tenantRegistrationId =
        location.state?.tenantRegistrationId || tenantId;
      console.log("Fetching tenant with ID:", tenantRegistrationId);

      const tenantData = await tenantService.getTenant(tenantRegistrationId);
      setTenant(tenantData);
    } catch (err) {
      setError("Failed to fetch tenant details");
      console.error("Error fetching tenant:", err);
    } finally {
      setLoading(false);
    }
  }, [location.state?.tenantRegistrationId]);

  useEffect(() => {
    if (id) {
      fetchTenant(id);
    }
  }, [fetchTenant, id]);

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
    if (!tenant || !id) return;

    try {
      setDeleting(true);
      setError(null);

      // Construct tenant object like Angular version
      const tenantToDelete = {
        tenantId: id,
        tenantData: {
          tenantName: location.state?.tenantName || "",
          email: location.state?.email || "",
          tier: location.state?.tier || "basic",
        },
        tenantRegistrationData: {
          tenantRegistrationId: tenant.tenantRegistrationId,
          registrationStatus: tenant.registrationStatus,
        },
      };

      console.log("Deleting tenant:", tenantToDelete);
      console.log(
        "API URL:",
        `/tenant-registrations/${tenant.tenantRegistrationId}`
      );

      const result = await tenantService.deleteTenant(tenantToDelete);
      console.log("Delete result:", result);

      navigate("/tenants");
    } catch (err: any) {
      console.error("Delete error details:", {
        message: err.message,
        response: err.response?.data,
        status: err.response?.status,
        url: err.config?.url,
      });
      setError(
        `Failed to delete tenant: ${err.response?.data?.message || err.message}`
      );
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  };

  if (loading) {
    return (
      <Box className="loading-container">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  if (!tenant) {
    return <Alert severity="error">Tenant not found</Alert>;
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
              mb: 4,
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
            <Button
              variant="contained"
              startIcon={<DeleteIcon />}
              onClick={() => setDeleteDialogOpen(true)}
              disabled={deleting || location.state?.sbtaws_active === false}
              className="delete-tenant-button"
            >
              Delete Tenant
            </Button>
          </Box>

          <Grid container spacing={3}>
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
                      {location.state?.tenantName || "N/A"}
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
                      {tenant.tenantRegistrationId || "N/A"}
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
                    <div className={`status-badge ${getStatusInfo(tenant.registrationStatus || "").className}`}>
                      {getStatusInfo(tenant.registrationStatus || "").icon}
                      {getStatusInfo(tenant.registrationStatus || "").label}
                    </div>
                  </Box>

                  <Box className="tenant-detail-field">
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      className="tenant-detail-field-label"
                    >
                      Tenant ID (from URL)
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
                    Tenant admin can modify these in Settings → Workspace after login.
                  </Typography>

                  {(() => {
                    const country = location.state?.country as string | undefined;
                    const settings = country ? (COUNTRY_SETTINGS[country] || DEFAULT_SETTINGS) : DEFAULT_SETTINGS;
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
