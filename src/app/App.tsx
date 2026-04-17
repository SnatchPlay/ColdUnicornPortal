import { Suspense, lazy } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { AppErrorBoundary } from "./components/app-error-boundary";
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
const DomainsPage = lazy(() => import("./pages/domains-page").then((module) => ({ default: module.DomainsPage })));
const InvoicesPage = lazy(() => import("./pages/invoices-page").then((module) => ({ default: module.InvoicesPage })));
const BlacklistPage = lazy(() => import("./pages/blacklist-page").then((module) => ({ default: module.BlacklistPage })));
const SettingsPage = lazy(() => import("./pages/settings-page").then((module) => ({ default: module.SettingsPage })));
const ResetPasswordPage = lazy(() =>
  import("./pages/reset-password-page").then((module) => ({ default: module.ResetPasswordPage })),
);

function roleHomePath(role: "admin" | "manager" | "client" | "super_admin") {
  if (role === "super_admin" || role === "admin") return "/admin/dashboard";
  if (role === "manager") return "/manager/dashboard";
  return "/client/dashboard";
}

function blockerMessage(errorCode: ReturnType<typeof useAuth>["errorCode"], error: string | null) {
  if (errorCode === "profile_missing") {
    return error ?? "Your account is authenticated, but the workspace profile is still being provisioned.";
  }
  if (errorCode === "client_mapping_missing") {
    return error ?? "Your client account is authenticated, but client access mapping is not assigned yet.";
  }
  if (errorCode === "permission") {
    return error ?? "Your authenticated session does not have permission to load this workspace.";
  }
  if (errorCode === "session_invalid") {
    return error ?? "Your session is no longer valid. Sign in again to continue.";
  }
  if (errorCode === "network") {
    return error ?? "The workspace could not be loaded because the network connection is unstable.";
  }
  return error ?? "The workspace could not be resolved for this authenticated session.";
}

export function SessionAccessBlocker() {
  const { error, errorCode, refreshIdentity, signOut } = useAuth();

  return (
    <div className="space-y-6">
      <Surface title="Account access requires attention" subtitle="Your session is authenticated, but workspace access is blocked.">
        <div className="space-y-4">
          <Banner tone={errorCode === "network" ? "warning" : "danger"}>{blockerMessage(errorCode, error)}</Banner>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => {
                void refreshIdentity();
              }}
              className="rounded-full border border-border px-4 py-2 text-sm text-foreground transition hover:border-primary/30"
            >
              Retry account check
            </button>
            <button
              onClick={() => {
                void signOut();
              }}
              className="rounded-full border border-border px-4 py-2 text-sm text-foreground transition hover:border-primary/30"
            >
              Sign out
            </button>
          </div>
        </div>
      </Surface>
    </div>
  );
}

export function RequireAuth() {
  const { session, loading } = useAuth();
  if (loading) return <LoadingState />;
  if (!session) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export function RequireRole({ allowed }: { allowed: AppRole[] }) {
  const { session, identity, loading } = useAuth();
  if (loading) return <LoadingState />;
  if (!session) return <Navigate to="/login" replace />;
  if (!identity) return <SessionAccessBlocker />;
  if (!allowed.includes(identity.role)) {
    return <Navigate to={roleHomePath(identity.role)} replace />;
  }
  return <Outlet />;
}

export function ClientAccessBlocker() {
  const { refreshIdentity, signOut } = useAuth();

  return (
    <div className="space-y-6">
      <Surface title="Account setup required" subtitle="Your client account is not assigned yet.">
        <Banner tone="warning">
          Access to this workspace will be enabled after your account setup is completed.
        </Banner>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            onClick={() => {
              void refreshIdentity();
            }}
            className="rounded-full border border-border px-4 py-2 text-sm text-foreground transition hover:border-primary/30"
          >
            Retry setup check
          </button>
          <button
            onClick={() => {
              void signOut();
            }}
            className="rounded-full border border-border px-4 py-2 text-sm text-foreground transition hover:border-primary/30"
          >
            Sign out
          </button>
        </div>
      </Surface>
    </div>
  );
}

export function HomeRedirect() {
  const { session, identity, loading } = useAuth();
  if (loading) return <LoadingState />;
  if (!session) return <Navigate to="/login" replace />;
  if (!identity) return <SessionAccessBlocker />;
  if (identity.role === "client" && !identity.clientId) return <Navigate to="/client/settings" replace />;
  return <Navigate to={roleHomePath(identity.role)} replace />;
}

function ProtectedApp() {
  const { actorIdentity, identity, session, error, isImpersonating } = useAuth();
  if (!session) return null;
  if (!identity) return <SessionAccessBlocker />;

  return (
    <AppErrorBoundary>
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
                <Route path="domains" element={<DomainsPage />} />
                <Route path="invoices" element={<InvoicesPage />} />
                <Route path="blacklist" element={<BlacklistPage />} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>

              <Route path="admin" element={<RequireRole allowed={["admin", "super_admin"]} />}>
                <Route path="dashboard" element={<DashboardPage />} />
                <Route path="clients" element={<ClientsPage />} />
                <Route path="leads" element={<LeadsPage />} />
                <Route path="campaigns" element={<CampaignsPage />} />
                <Route path="statistics" element={<StatisticsPage />} />
                <Route path="domains" element={<DomainsPage />} />
                <Route path="invoices" element={<InvoicesPage />} />
                <Route path="blacklist" element={<BlacklistPage />} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>

              <Route path="*" element={<HomeRedirect />} />
            </Routes>
          </Suspense>
        </div>
      </AppShell>
    </AppErrorBoundary>
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
            <p>Create a local `.env` file from `.env.example` and restart `corepack pnpm dev`.</p>
            <p>Expected variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_APP_BASE_URL`.</p>
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
      <Toaster position="top-right" richColors closeButton />
    </div>
  );
}
