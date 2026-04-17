import { Banner, EmptyState, PageHeader, Surface } from "../components/app-ui";
import { runtimeConfig } from "../lib/env";
import { formatDate } from "../lib/format";
import { getRoleLabel } from "../lib/selectors";
import { useAuth } from "../providers/auth";

export function SettingsPage() {
  const { actorIdentity, identity, error, isImpersonating } = useAuth();

  if (!identity) {
    return (
      <EmptyState
        title="No identity loaded"
        description="Sign in with a Supabase-linked user to open the settings workspace."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        subtitle="Runtime and workspace settings. Client users see profile context; internal roles see architecture and delivery guardrails."
      />

      {error && <Banner tone="warning">{error}</Banner>}

      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <Surface title="Current identity" subtitle="Resolved by auth/bootstrap layer.">
          <div className="space-y-3 text-sm">
            {actorIdentity && (
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Actor</p>
                <p className="mt-1">
                  {actorIdentity.fullName} · {actorIdentity.email}
                </p>
                <p className="text-xs text-muted-foreground">{getRoleLabel(actorIdentity.role)}</p>
              </div>
            )}
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Effective name</p>
              <p className="mt-1">{identity.fullName}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Effective email</p>
              <p className="mt-1">{identity.email}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Effective role</p>
              <p className="mt-1">{getRoleLabel(identity.role)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Impersonation</p>
              <p className="mt-1">{isImpersonating ? "Active" : "Off"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Runtime mode</p>
              <p className="mt-1">Supabase auth · Supabase data</p>
            </div>
          </div>
        </Surface>

        <Surface
          title="Implementation notes"
          subtitle="Release posture and delivery guardrails for the current production-ready runtime."
        >
          <div className="space-y-4 text-sm text-muted-foreground">
            <p>
              This runtime assumes route-based role shells, live-schema contracts, invite/account-created
              access, and publishable-key-only frontend auth.
            </p>
            <p>
              Password reset redirects are resolved against <code>VITE_APP_BASE_URL</code>, while missing
              profile linkage, client mapping, permission denials, and invalid sessions stay visible as
              explicit blocker states.
            </p>
            <p>Magic link access: {runtimeConfig.authAllowMagicLink ? "enabled for provisioned users" : "disabled"}.</p>
            <p>Internal impersonation tooling: {runtimeConfig.allowInternalImpersonation ? "enabled" : "disabled in production"}.</p>
            <p>Last review timestamp: {formatDate(new Date().toISOString())}</p>
          </div>
        </Surface>
      </div>
    </div>
  );
}
