import { Suspense, lazy } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/app-shell";
import { Banner, LoadingState, Surface } from "./components/app-ui";
import { runtimeConfig } from "./lib/env";
import { AppProviders } from "./providers";
import { useAuth } from "./providers/auth";
import { LoginPage } from "./pages/login-page";
import { getRoleLabel } from "./lib/selectors";
import type { AppRole } from "./types/core";

const DashboardPage = lazy(() => import("./pages/dashboard-page").then((module) => ({ default: module.DashboardPage })));
const LeadsPage = lazy(() => import("./pages/leads-page").then((module) => ({ default: module.LeadsPage })));
const CampaignsPage = lazy(() =>
  import("./pages/campaigns-page").then((module) => ({ default: module.CampaignsPage })),
);
const StatisticsPage = lazy(() =>
  import("./pages/statistics-page").then((module) => ({ default: module.StatisticsPage })),
);
const ClientsPage = lazy(() => import("./pages/clients-page").then((module) => ({ default: module.ClientsPage })));
const SettingsPage = lazy(() => import("./pages/settings-page").then((module) => ({ default: module.SettingsPage })));
const ResetPasswordPage = lazy(() =>
  import("./pages/reset-password-page").then((module) => ({ default: module.ResetPasswordPage })),
);

function roleHomePath(role: "admin" | "manager" | "client" | "super_admin") {
  if (role === "super_admin" || role === "admin") return "/admin/dashboard";
  if (role === "manager") return "/manager/dashboard";
  return "/client/dashboard";
}

function RequireAuth() {
  const { identity, loading } = useAuth();
  if (loading) return <LoadingState />;
  if (!identity) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function RequireRole({ allowed }: { allowed: AppRole[] }) {
  const { identity, loading } = useAuth();
  if (loading) return <LoadingState />;
  if (!identity) return <Navigate to="/login" replace />;
  if (!allowed.includes(identity.role)) {
    return <Navigate to={roleHomePath(identity.role)} replace />;
  }
  return <Outlet />;
}

function ClientAccessBlocker() {
  return (
    <div className="space-y-6">
      <Surface title="Account setup required" subtitle="Your client account is not assigned yet.">
        <Banner tone="warning">
          Access to this workspace will be enabled after your account setup is completed.
        </Banner>
      </Surface>
    </div>
  );
}

function HomeRedirect() {
  const { identity, loading } = useAuth();
  if (loading) return <LoadingState />;
  if (!identity) return <Navigate to="/login" replace />;
  if (identity.role === "client" && !identity.clientId) return <Navigate to="/client/settings" replace />;
  return <Navigate to={roleHomePath(identity.role)} replace />;
}

function ProtectedApp() {
  const { actorIdentity, identity, error, isImpersonating } = useAuth();
  if (!identity) return null;

  return (
    <AppShell>
      <div className="space-y-5">
        {isImpersonating && actorIdentity && (
          <Banner tone="info">
            Impersonation mode is active. Actor: {actorIdentity.fullName} ({getRoleLabel(actorIdentity.role)}). Effective role:{" "}
            {getRoleLabel(identity.role)}.
          </Banner>
        )}
        {error && (
          <Banner tone="warning">
            {error} Current role: {getRoleLabel(identity.role)}.
          </Banner>
        )}
        <Suspense fallback={<LoadingState />}>
          <Routes>
            <Route index element={<HomeRedirect />} />

            <Route path="client" element={<RequireRole allowed={["client"]} />}>
              <Route element={<Outlet />}>
                <Route path="dashboard" element={identity.clientId ? <DashboardPage /> : <ClientAccessBlocker />} />
                <Route path="leads" element={identity.clientId ? <LeadsPage /> : <ClientAccessBlocker />} />
                <Route path="campaigns" element={identity.clientId ? <CampaignsPage /> : <ClientAccessBlocker />} />
                <Route path="statistics" element={identity.clientId ? <StatisticsPage /> : <ClientAccessBlocker />} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>
            </Route>

            <Route path="manager" element={<RequireRole allowed={["manager"]} />}>
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="clients" element={<ClientsPage />} />
              <Route path="leads" element={<LeadsPage />} />
              <Route path="campaigns" element={<CampaignsPage />} />
              <Route path="statistics" element={<StatisticsPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>

            <Route path="admin" element={<RequireRole allowed={["admin", "super_admin"]} />}>
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="clients" element={<ClientsPage />} />
              <Route path="leads" element={<LeadsPage />} />
              <Route path="campaigns" element={<CampaignsPage />} />
              <Route path="statistics" element={<StatisticsPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>

            <Route path="*" element={<HomeRedirect />} />
          </Routes>
        </Suspense>
      </div>
    </AppShell>
  );
}

function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/home" element={<Navigate to="/" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/reset-password"
          element={
            <Suspense fallback={<LoadingState />}>
              <ResetPasswordPage />
            </Suspense>
          }
        />
        <Route element={<RequireAuth />}>
          <Route path="/*" element={<ProtectedApp />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

function RuntimeConfigScreen() {
  return (
    <div className="dark min-h-screen bg-[linear-gradient(180deg,_rgba(15,23,42,1),_rgba(2,6,23,1))] px-4 py-8 text-foreground">
      <div className="mx-auto flex min-h-[80vh] max-w-3xl items-center">
        <Surface
          title="Runtime configuration is missing"
          subtitle="The app cannot bootstrap Supabase without environment variables."
          className="w-full"
        >
          <div className="space-y-4 text-sm text-muted-foreground">
            <Banner tone="danger">{runtimeConfig.error ?? "Unknown runtime configuration error."}</Banner>
            <p>Create a local `.env` file from `.env.example` and restart `npm run dev`.</p>
            <p>Expected variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.</p>
          </div>
        </Surface>
      </div>
    </div>
  );
}

export default function App() {
  if (!runtimeConfig.isConfigured) {
    return <RuntimeConfigScreen />;
  }

  return (
    <div className="dark">
      <AppProviders>
        <AppRouter />
      </AppProviders>
    </div>
  );
}
