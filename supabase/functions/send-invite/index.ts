import { createClient } from "npm:@supabase/supabase-js@2.57.4";

type InviteRole = "admin" | "manager" | "client";
type ActorRole = "super_admin" | "admin" | "manager" | "client";

interface InvitePayload {
  email: string;
  role: InviteRole;
  clientId?: string;
  redirectTo?: string;
  firstName?: string;
  lastName?: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeInviteRole(value: unknown): InviteRole | null {
  if (value === "client" || value === "manager" || value === "admin") return value;
  return null;
}

function buildInviteRedirect(payloadRedirectTo?: string) {
  const appBaseUrl = Deno.env.get("APP_BASE_URL")?.trim() ?? "";
  const fallback = appBaseUrl ? new URL("/reset-password", `${appBaseUrl.replace(/\/+$/, "")}/`).toString() : undefined;
  if (!payloadRedirectTo) return fallback;
  try {
    const redirect = new URL(payloadRedirectTo);
    if (!appBaseUrl) return redirect.toString();
    const base = new URL(appBaseUrl);
    if (redirect.origin !== base.origin) return fallback;
    return redirect.toString();
  } catch {
    return fallback;
  }
}

function deriveNameFromEmail(email: string) {
  const localPart = email.split("@")[0] ?? "";
  const token = localPart.replace(/[^a-zA-Z0-9]+/g, " ").trim();
  if (!token) return { firstName: "Invited", lastName: "User" };
  const parts = token.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "User" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed." });
  }

  const envSupabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const supabaseUrl = envSupabaseUrl || new URL(request.url).origin;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
  if (!serviceRoleKey) return jsonResponse(500, { ok: false, error: "Function is not configured with Supabase service credentials." });
  if (!anonKey) return jsonResponse(500, { ok: false, error: "Function is missing SUPABASE_ANON_KEY / SUPABASE_PUBLISHABLE_KEY." });

  const authHeader = request.headers.get("Authorization") ?? "";
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!accessToken) return jsonResponse(401, { ok: false, error: "Missing bearer token." });

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) {
    const details = authError?.message ?? "No authenticated user in token.";
    return jsonResponse(401, { ok: false, error: `Invalid access token. ${details}` });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const actorId = authData.user.id;
  const { data: actorRow, error: actorError } = await adminClient
    .from("users").select("id, role").eq("id", actorId)
    .maybeSingle<{ id: string; role: ActorRole }>();
  if (actorError || !actorRow) return jsonResponse(403, { ok: false, error: "You do not have permission to invite users." });

  const payload = (await request.json().catch(() => null)) as InvitePayload | null;
  if (!payload) return jsonResponse(400, { ok: false, error: "Request body is required." });

  const normalizedEmail = payload.email?.trim().toLowerCase();
  const inviteRole = normalizeInviteRole(payload.role);
  if (!normalizedEmail || !isValidEmail(normalizedEmail)) return jsonResponse(400, { ok: false, error: "A valid email is required." });
  if (!inviteRole) return jsonResponse(400, { ok: false, error: "Invite role is invalid." });

  const isAdminActor = actorRow.role === "admin" || actorRow.role === "super_admin";
  const isManagerActor = actorRow.role === "manager";
  if (!isAdminActor && !isManagerActor) return jsonResponse(403, { ok: false, error: "Only internal roles can invite users." });
  if (isManagerActor && inviteRole !== "client") return jsonResponse(403, { ok: false, error: "Managers can invite client users only." });

  const normalizedClientId = payload.clientId?.trim();
  if (inviteRole === "client" && !normalizedClientId) return jsonResponse(400, { ok: false, error: "Client invites require a clientId." });

  if (normalizedClientId) {
    const { data: targetClient, error: targetClientError } = await adminClient
      .from("clients").select("id, manager_id").eq("id", normalizedClientId)
      .maybeSingle<{ id: string; manager_id: string }>();
    if (targetClientError || !targetClient) return jsonResponse(404, { ok: false, error: "Client was not found." });
    if (isManagerActor && targetClient.manager_id !== actorId) return jsonResponse(403, { ok: false, error: "Managers can invite client users only for assigned clients." });
  }

  const derivedName = deriveNameFromEmail(normalizedEmail);
  const firstName = payload.firstName?.trim() || derivedName.firstName;
  const lastName = payload.lastName?.trim() || derivedName.lastName;
  const inviteRedirect = buildInviteRedirect(payload.redirectTo);

  const { data: inviteResult, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(normalizedEmail, {
    ...(inviteRedirect ? { redirectTo: inviteRedirect } : {}),
    data: {
      first_name: firstName,
      last_name: lastName,
      invited_role: inviteRole,
      invited_client_id: normalizedClientId ?? null,
      invited_by: actorId,
    },
  });

  if (inviteError || !inviteResult?.user) {
    const status = (inviteError as { status?: number } | null)?.status ?? 400;
    const name = (inviteError as { name?: string } | null)?.name ?? "";
    const message = inviteError?.message ?? "Invitation could not be created.";
    return jsonResponse(status >= 400 && status < 600 ? status : 400, {
      ok: false,
      error: `Invite failed (${name || "error"} ${status}): ${message}`,
      debug: { supabaseUrl, endpoint: `${supabaseUrl}/auth/v1/invite` },
    });
  }

  const invitedUserId = inviteResult.user.id;
  const invitedEmail = inviteResult.user.email?.trim().toLowerCase() ?? normalizedEmail;

  const { error: upsertUserError } = await adminClient.from("users").upsert(
    {
      id: invitedUserId,
      email: invitedEmail,
      first_name: firstName,
      last_name: lastName,
      role: inviteRole,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (upsertUserError) return jsonResponse(500, { ok: false, error: `Invitation sent but profile upsert failed: ${upsertUserError.message}` });

  if (inviteRole === "client" && normalizedClientId) {
    const { error: mappingError } = await adminClient.from("client_users").upsert(
      { user_id: invitedUserId, client_id: normalizedClientId },
      { onConflict: "user_id" },
    );
    if (mappingError) return jsonResponse(500, { ok: false, error: `Invitation sent but client mapping failed: ${mappingError.message}` });
  }

  return jsonResponse(200, { ok: true, inviteId: invitedUserId });
});
