import React from 'react';
import {
  Grid,
  Card,
  CardContent,
  Typography,
  Box,
  Paper,
  Chip,
  Alert,
  Button,
  Skeleton,
  List,
  ListItemButton,
  ListItemText,
  ListItemIcon,
} from '@mui/material';
import {
  People as PeopleIcon,
  Business as BusinessIcon,
  Block as BlockIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  HourglassEmpty as HourglassIcon,
  Add as AddIcon,
  ChevronRight as ChevronRightIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useDashboardStats } from '../../hooks/useDashboardStats';
import { TIER_COLORS, STATUS_COLORS } from '../../constants/pricing';
import { Tenant } from '../../models/tenant';

const StatCardSkeleton: React.FC = () => (
  <Grid item xs={12} sm={6} md={4}>
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <Skeleton variant="rounded" width={40} height={40} sx={{ mr: 2 }} />
          <Skeleton variant="text" width="60%" height={28} />
        </Box>
        <Skeleton variant="text" width="40%" height={48} />
      </CardContent>
    </Card>
  </Grid>
);

const Dashboard: React.FC = () => {
  const {
    totalCount,
    activeCount,
    inactiveCount,
    tierDistribution,
    statusDistribution,
    recentTenants,
    loading,
    error,
    refetch,
  } = useDashboardStats();
  const navigate = useNavigate();

  const statCards = [
    {
      title: 'Total Tenants',
      value: totalCount,
      icon: <PeopleIcon />,
      color: '#1976d2',
    },
    {
      title: 'Active Tenants',
      value: activeCount,
      icon: <BusinessIcon />,
      color: '#2e7d32',
    },
    {
      title: 'Inactive',
      value: inactiveCount,
      icon: <BlockIcon />,
      color: '#9e9e9e',
    },
  ];

  const handleTenantClick = (tenant: Tenant) => {
    const t = tenant as any;
    const tenantId = tenant.tenantId || '';
    navigate(`/tenants/${tenantId}`, {
      state: {
        tenantName: tenant.tenantData?.tenantName || t.tenantName,
        email: tenant.tenantData?.email || t.email,
        tier: tenant.tenantData?.tier || t.tier,
        country: tenant.tenantData?.country || t.country,
        useFederation: tenant.tenantData?.useFederation || t.useFederation,
        useEc2: tenant.tenantData?.useEc2 || t.useEc2,
        useRProxy: tenant.tenantData?.useRProxy || t.useRProxy,
        tenantRegistrationId:
          tenant.tenantRegistrationData?.tenantRegistrationId || t.tenantRegistrationId || tenant.tenantId,
        sbtaws_active: tenant.sbtaws_active ?? t.sbtaws_active,
      },
    });
  };

  const getStatusColor = (status: string): string => {
    return STATUS_COLORS[status.toLowerCase() as keyof typeof STATUS_COLORS] || 'default';
  };

  const getStatusIcon = (status: string) => {
    const s = status.toLowerCase();
    if (['complete', 'created', 'active'].includes(s)) return <CheckCircleIcon fontSize="small" color="success" />;
    if (['failed', 'error'].includes(s)) return <ErrorIcon fontSize="small" color="error" />;
    return <HourglassIcon fontSize="small" color="warning" />;
  };

  // Error state
  if (error && !loading) {
    return (
      <Box>
        <Typography variant="h4" className="page-title">Dashboard</Typography>
        <Typography variant="body2" className="page-subtitle" sx={{ mb: 3 }}>
          Monitor your SaaS platform performance and tenant metrics
        </Typography>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={refetch}>
              Retry
            </Button>
          }
        >
          Failed to load dashboard data: {error}
        </Alert>
      </Box>
    );
  }

  return (
    <Box>
      <div>
        <Typography variant="h4" className="page-title">
          Dashboard
        </Typography>
        <Typography variant="body2" className="page-subtitle">
          Monitor your SaaS platform performance and tenant metrics
        </Typography>
      </div>

      {/* Stat Cards */}
      <Grid container spacing={3}>
        {loading ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          statCards.map((stat, index) => (
            <Grid item xs={12} sm={6} md={4} key={index}>
              <Card>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <Box
                      sx={{
                        backgroundColor: stat.color,
                        color: 'white',
                        borderRadius: 1,
                        p: 1,
                        mr: 2,
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      {stat.icon}
                    </Box>
                    <Typography variant="h6" component="div">
                      {stat.title}
                    </Typography>
                  </Box>
                  <Typography variant="h4" component="div" color={stat.color}>
                    {stat.value}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))
        )}
      </Grid>

      {/* Tier Distribution + Status Summary */}
      <Grid container spacing={3} sx={{ mt: 1 }}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Tier Distribution
            </Typography>
            {loading ? (
              <Box sx={{ display: 'flex', gap: 2 }}>
                <Skeleton variant="rounded" width={80} height={32} />
                <Skeleton variant="rounded" width={80} height={32} />
                <Skeleton variant="rounded" width={80} height={32} />
              </Box>
            ) : totalCount === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No tenants provisioned yet.
              </Typography>
            ) : (
              <Box>
                <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
                  <Chip
                    label={`Basic: ${tierDistribution.basic}`}
                    color={TIER_COLORS.basic as any}
                    variant={tierDistribution.basic > 0 ? 'filled' : 'outlined'}
                  />
                  <Chip
                    label={`Advanced: ${tierDistribution.advanced}`}
                    color={TIER_COLORS.advanced as any}
                    variant={tierDistribution.advanced > 0 ? 'filled' : 'outlined'}
                  />
                  <Chip
                    label={`Premium: ${tierDistribution.premium}`}
                    color={TIER_COLORS.premium as any}
                    variant={tierDistribution.premium > 0 ? 'filled' : 'outlined'}
                  />
                </Box>
                {totalCount > 0 && (
                  <Box sx={{ display: 'flex', gap: 0.5, borderRadius: 1, overflow: 'hidden', height: 8 }}>
                    {tierDistribution.basic > 0 && (
                      <Box sx={{ flex: tierDistribution.basic, bgcolor: '#9e9e9e', minWidth: 4 }} />
                    )}
                    {tierDistribution.advanced > 0 && (
                      <Box sx={{ flex: tierDistribution.advanced, bgcolor: '#1976d2', minWidth: 4 }} />
                    )}
                    {tierDistribution.premium > 0 && (
                      <Box sx={{ flex: tierDistribution.premium, bgcolor: '#9c27b0', minWidth: 4 }} />
                    )}
                  </Box>
                )}
              </Box>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Provisioning Status
            </Typography>
            {loading ? (
              <Box sx={{ display: 'flex', gap: 2 }}>
                <Skeleton variant="rounded" width={80} height={32} />
                <Skeleton variant="rounded" width={80} height={32} />
                <Skeleton variant="rounded" width={80} height={32} />
              </Box>
            ) : totalCount === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No tenants provisioned yet.
              </Typography>
            ) : (
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <Chip
                  icon={<CheckCircleIcon />}
                  label={`Complete: ${statusDistribution.complete}`}
                  color="success"
                  variant={statusDistribution.complete > 0 ? 'filled' : 'outlined'}
                />
                <Chip
                  icon={<HourglassIcon />}
                  label={`In Progress: ${statusDistribution.inProgress}`}
                  color="warning"
                  variant={statusDistribution.inProgress > 0 ? 'filled' : 'outlined'}
                />
                <Chip
                  icon={<ErrorIcon />}
                  label={`Failed: ${statusDistribution.failed}`}
                  color="error"
                  variant={statusDistribution.failed > 0 ? 'filled' : 'outlined'}
                />
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>

      {/* Recent Tenants */}
      <Box sx={{ mt: 3 }}>
        <Paper sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="h6">
              Recent Tenant Activity
            </Typography>
            {!loading && totalCount > 0 && (
              <Button
                size="small"
                onClick={() => navigate('/tenants')}
                endIcon={<ChevronRightIcon />}
              >
                View All
              </Button>
            )}
          </Box>

          {loading ? (
            <Box>
              {[0, 1, 2].map((i) => (
                <Box key={i} sx={{ display: 'flex', alignItems: 'center', py: 1.5, gap: 2 }}>
                  <Skeleton variant="circular" width={32} height={32} />
                  <Skeleton variant="text" width="30%" height={24} />
                  <Skeleton variant="rounded" width={60} height={24} />
                  <Skeleton variant="rounded" width={80} height={24} />
                </Box>
              ))}
            </Box>
          ) : recentTenants.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography variant="body1" color="text.secondary" gutterBottom>
                No tenants provisioned yet.
              </Typography>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => navigate('/tenants/create')}
                sx={{ mt: 1 }}
              >
                Create Your First Tenant
              </Button>
            </Box>
          ) : (
            <List disablePadding>
              {recentTenants.map((tenant) => {
                const name = tenant.tenantData?.tenantName || (tenant as any).tenantName || tenant.tenantId || 'Unknown';
                const tier = tenant.tenantData?.tier || (tenant as any).tier || 'unknown';
                const status = tenant.tenantRegistrationData?.registrationStatus || (tenant as any).registrationStatus || 'unknown';
                const isActive = tenant.sbtaws_active !== false;

                return (
                  <ListItemButton
                    key={tenant.tenantId}
                    onClick={() => handleTenantClick(tenant)}
                    sx={{
                      borderRadius: 1,
                      mb: 0.5,
                      opacity: isActive ? 1 : 0.6,
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      {getStatusIcon(status)}
                    </ListItemIcon>
                    <ListItemText
                      primary={name}
                      primaryTypographyProps={{ fontWeight: 500 }}
                    />
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      <Chip
                        label={tier.toUpperCase()}
                        color={TIER_COLORS[tier.toLowerCase() as keyof typeof TIER_COLORS] as any || 'default'}
                        size="small"
                      />
                      <Chip
                        label={status.toUpperCase()}
                        color={getStatusColor(status) as any}
                        size="small"
                      />
                      {!isActive && (
                        <Chip label="INACTIVE" size="small" sx={{ bgcolor: '#e0e0e0' }} />
                      )}
                    </Box>
                  </ListItemButton>
                );
              })}
            </List>
          )}
        </Paper>
      </Box>
    </Box>
  );
};

export default Dashboard;
