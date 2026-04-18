import { createClient } from "npm:@supabase/supabase-js@2.57.4";

type InviteRole = "admin" | "manager" | "client";
type InviteStatus = "pending" | "accepted" | "expired";
type ActorRole = "super_admin" | "admin" | "manager" | "client";

interface InviteMetadata {
  invited_role?: string;
  invited_client_id?: string | null;
  invited_by?: string | null;
  first_name?: string;
  last_name?: string;
}

interface InviteRecord {
  id: string;
  email: string;
  role: InviteRole;
  status: InviteStatus;
  invitedAt: string | null;
  acceptedAt: string | null;
  expiresAt: string | null;
  clientId: string | null;
  clientName: string | null;
  invitedById: string | null;
  invitedByName: string | null;
  canResend: boolean;
  canRevoke: boolean;
}

interface ListRequest {
  action: "list";
}

interface ResendRequest {
  action: "resend";
  inviteId: string;
}

interface RevokeRequest {
  action: "revoke";
  inviteId: string;
}

type RequestBody = ListRequest | ResendRequest | RevokeRequest;

const INVITE_TTL_HOURS = Number(Deno.env.get("INVITE_EXPIRY_HOURS") ?? "168");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function normalizeInviteRole(value: unknown): InviteRole | null {
  if (value === "client" || value === "manager" || value === "admin") return value;
  return null;
}

function isAccepted(user: { email_confirmed_at?: string | null; last_sign_in_at?: string | null }) {
  return Boolean(user.email_confirmed_at || user.last_sign_in_at);
}

function deriveNameFromEmail(email: string) {
  const localPart = email.split("@")[0] ?? "";
  const token = localPart.replace(/[^a-zA-Z0-9]+/g, " ").trim();
  if (!token) return { firstName: "Invited", lastName: "User" };
  const parts = token.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "User" };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

function getInviteTimestamps(user: { invited_at?: string | null; created_at?: string | null; email_confirmed_at?: string | null; last_sign_in_at?: string | null }) {
  const invitedAt = user.invited_at ?? user.created_at ?? null;
  const acceptedAt = user.email_confirmed_at ?? user.last_sign_in_at ?? null;

  if (!invitedAt) {
    return {
      invitedAt: null,
      acceptedAt,
      expiresAt: null,
      status: acceptedAt ? "accepted" : "pending",
    } as const;
  }

  const invitedMs = new Date(invitedAt).getTime();
  const expiresMs = invitedMs + INVITE_TTL_HOURS * 60 * 60 * 1000;
  const expiresAt = new Date(expiresMs).toISOString();
  const expired = Date.now() > expiresMs;

  return {
    invitedAt,
    acceptedAt,
    expiresAt,
    status: acceptedAt ? "accepted" : expired ? "expired" : "pending",
  } as const;
}

function toFullName(firstName?: string | null, lastName?: string | null) {
  const value = `${firstName ?? ""} ${lastName ?? ""}`.trim();
  return value || null;
}

async function listAllAuthUsers(adminClient: ReturnType<typeof createClient>) {
  const allUsers: Array<Record<string, unknown>> = [];
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw error;
    }

    const users = (data?.users ?? []) as Array<Record<string, unknown>>;
    allUsers.push(...users);
    if (users.length < perPage) {
      break;
    }

    page += 1;
    if (page > 25) {
      break;
    }
  }

  return allUsers;
}

function buildInviteRecord({
  authUser,
  profileById,
  clientById,
  mappingByUserId,
}: {
  authUser: Record<string, unknown>;
  profileById: Map<string, { id: string; first_name: string | null; last_name: string | null }>;
  clientById: Map<string, { id: string; name: string }>;
  mappingByUserId: Map<string, string>;
}): InviteRecord | null {
  const id = typeof authUser.id === "string" ? authUser.id : null;
  const email = typeof authUser.email === "string" ? authUser.email.trim().toLowerCase() : null;
  if (!id || !email) return null;

  const metadata = (authUser.user_metadata ?? {}) as InviteMetadata;
  const role = normalizeInviteRole(metadata.invited_role);
  if (!role) return null;

  const timestamps = getInviteTimestamps({
    invited_at: (authUser.invited_at as string | null | undefined) ?? null,
    created_at: (authUser.created_at as string | null | undefined) ?? null,
    email_confirmed_at: (authUser.email_confirmed_at as string | null | undefined) ?? null,
    last_sign_in_at: (authUser.last_sign_in_at as string | null | undefined) ?? null,
  });

  const clientId = (metadata.invited_client_id ?? mappingByUserId.get(id) ?? null) as string | null;
  const invitedById = (metadata.invited_by ?? null) as string | null;
  const invitedByProfile = invitedById ? profileById.get(invitedById) : null;

  return {
    id,
    email,
    role,
    status: timestamps.status,
    invitedAt: timestamps.invitedAt,
    acceptedAt: timestamps.acceptedAt,
    expiresAt: timestamps.expiresAt,
    clientId,
    clientName: clientId ? clientById.get(clientId)?.name ?? null : null,
    invitedById,
    invitedByName: invitedByProfile ? toFullName(invitedByProfile.first_name, invitedByProfile.last_name) : null,
    canResend: timestamps.status !== "accepted",
    canRevoke: timestamps.status !== "accepted",
  };
}

function isAdminActor(role: ActorRole) {
  return role === "admin" || role === "super_admin";
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

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed." });
  }

  const supabaseUrl = new URL(request.url).origin;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey =
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
  if (!serviceRoleKey) {
    return jsonResponse(500, { ok: false, error: "Function is not configured with Supabase service credentials." });
  }
  if (!anonKey) {
    return jsonResponse(500, {
      ok: false,
      error: "Function is missing SUPABASE_ANON_KEY / SUPABASE_PUBLISHABLE_KEY.",
    });
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!accessToken) {
    return jsonResponse(401, { ok: false, error: "Missing bearer token." });
  }

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
    .from("users")
    .select("id, role")
    .eq("id", actorId)
    .maybeSingle<{ id: string; role: ActorRole }>();

  if (actorError || !actorRow || !isAdminActor(actorRow.role)) {
    return jsonResponse(403, { ok: false, error: "Only admin roles can manage invitations." });
  }

  const body = (await request.json().catch(() => null)) as RequestBody | null;
  if (!body || typeof body !== "object" || !("action" in body)) {
    return jsonResponse(400, { ok: false, error: "Request body with action is required." });
  }

  if (body.action === "list") {
    try {
      const authUsers = await listAllAuthUsers(adminClient);
      const inviteCandidates = authUsers.filter((user) => {
        const metadata = (user.user_metadata ?? {}) as InviteMetadata;
        return normalizeInviteRole(metadata.invited_role) !== null;
      });

      if (inviteCandidates.length === 0) {
        return jsonResponse(200, { ok: true, invites: [] });
      }

      const inviteIds = inviteCandidates
        .map((user) => (typeof user.id === "string" ? user.id : null))
        .filter((value): value is string => Boolean(value));

      const invitedByIds = inviteCandidates
        .map((user) => {
          const metadata = (user.user_metadata ?? {}) as InviteMetadata;
          return typeof metadata.invited_by === "string" ? metadata.invited_by : null;
        })
        .filter((value): value is string => Boolean(value));

      const uniqueProfileIds = Array.from(new Set([...inviteIds, ...invitedByIds]));

      const profileById = new Map<string, { id: string; first_name: string | null; last_name: string | null }>();
      if (uniqueProfileIds.length > 0) {
        const { data: profiles, error: profilesError } = await adminClient
          .from("users")
          .select("id, first_name, last_name")
          .in("id", uniqueProfileIds);

        if (profilesError) {
          return jsonResponse(500, { ok: false, error: profilesError.message });
        }

        for (const profile of profiles ?? []) {
          profileById.set(profile.id, profile);
        }
      }

      const mappingByUserId = new Map<string, string>();
      const { data: mappings, error: mappingError } = await adminClient
        .from("client_users")
        .select("user_id, client_id")
        .in("user_id", inviteIds);

      if (mappingError) {
        return jsonResponse(500, { ok: false, error: mappingError.message });
      }

      const clientIdsFromMappings = new Set<string>();
      for (const mapping of mappings ?? []) {
        mappingByUserId.set(mapping.user_id, mapping.client_id);
        clientIdsFromMappings.add(mapping.client_id);
      }

      for (const user of inviteCandidates) {
        const metadata = (user.user_metadata ?? {}) as InviteMetadata;
        if (typeof metadata.invited_client_id === "string") {
          clientIdsFromMappings.add(metadata.invited_client_id);
        }
      }

      const clientById = new Map<string, { id: string; name: string }>();
      const clientIds = Array.from(clientIdsFromMappings);
      if (clientIds.length > 0) {
        const { data: clients, error: clientsError } = await adminClient
          .from("clients")
          .select("id, name")
          .in("id", clientIds);

        if (clientsError) {
          return jsonResponse(500, { ok: false, error: clientsError.message });
        }

        for (const client of clients ?? []) {
          clientById.set(client.id, client);
        }
      }

      const invites: InviteRecord[] = inviteCandidates
        .map((authUser) =>
          buildInviteRecord({
            authUser,
            profileById,
            clientById,
            mappingByUserId,
          }),
        )
        .filter((item): item is InviteRecord => item !== null)
        .sort((left, right) => (right.invitedAt ?? "").localeCompare(left.invitedAt ?? ""));

      return jsonResponse(200, { ok: true, invites });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load invitations.";
      return jsonResponse(500, { ok: false, error: message });
    }
  }

  if (body.action === "resend") {
    const inviteId = body.inviteId?.trim();
    if (!inviteId) {
      return jsonResponse(400, { ok: false, error: "inviteId is required." });
    }

    const { data: targetData, error: targetError } = await adminClient.auth.admin.getUserById(inviteId);
    const targetUser = targetData?.user ?? null;

    if (targetError || !targetUser) {
      return jsonResponse(404, { ok: false, error: "Invite target was not found." });
    }

    const metadata = (targetUser.user_metadata ?? {}) as InviteMetadata;
    const role = normalizeInviteRole(metadata.invited_role);
    const email = targetUser.email?.trim().toLowerCase() ?? "";

    if (!role || !email) {
      return jsonResponse(400, { ok: false, error: "Invite metadata is missing on this user." });
    }

    if (isAccepted(targetUser)) {
      return jsonResponse(400, { ok: false, error: "Accepted invites cannot be resent." });
    }

    let clientId = metadata.invited_client_id ?? null;
    if (role === "client" && !clientId) {
      const { data: existingMapping } = await adminClient
        .from("client_users")
        .select("client_id")
        .eq("user_id", targetUser.id)
        .maybeSingle<{ client_id: string }>();
      clientId = existingMapping?.client_id ?? null;
    }

    if (role === "client" && !clientId) {
      return jsonResponse(400, { ok: false, error: "Client invites require a client assignment." });
    }

    const fallbackName = deriveNameFromEmail(email);
    const firstName = metadata.first_name?.trim() || fallbackName.firstName;
    const lastName = metadata.last_name?.trim() || fallbackName.lastName;

    const { error: deleteError } = await adminClient.auth.admin.deleteUser(targetUser.id);
    if (deleteError) {
      return jsonResponse(500, { ok: false, error: `Could not revoke previous invite: ${deleteError.message}` });
    }

    await adminClient.from("client_users").delete().eq("user_id", targetUser.id);
    await adminClient.from("users").delete().eq("id", targetUser.id);

    const inviteRedirect = buildInviteRedirect();
    const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      ...(inviteRedirect ? { redirectTo: inviteRedirect } : {}),
      data: {
        first_name: firstName,
        last_name: lastName,
        invited_role: role,
        invited_client_id: clientId,
        invited_by: actorId,
      },
    });

    if (inviteError || !inviteData.user) {
      return jsonResponse(500, { ok: false, error: inviteError?.message ?? "Could not resend invitation." });
    }

    const nextUserId = inviteData.user.id;

    const { error: upsertProfileError } = await adminClient.from("users").upsert(
      {
        id: nextUserId,
        email,
        first_name: firstName,
        last_name: lastName,
        role,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );

    if (upsertProfileError) {
      return jsonResponse(500, {
        ok: false,
        error: `Invitation was resent but profile upsert failed: ${upsertProfileError.message}`,
      });
    }

    if (role === "client" && clientId) {
      const { error: mappingError } = await adminClient.from("client_users").upsert(
        {
          user_id: nextUserId,
          client_id: clientId,
        },
        { onConflict: "user_id" },
      );

      if (mappingError) {
        return jsonResponse(500, {
          ok: false,
          error: `Invitation was resent but client mapping failed: ${mappingError.message}`,
        });
      }
    }

    const { data: inviterProfile } = await adminClient
      .from("users")
      .select("first_name, last_name")
      .eq("id", actorId)
      .maybeSingle<{ first_name: string | null; last_name: string | null }>();

    const invite: InviteRecord = {
      id: nextUserId,
      email,
      role,
      status: "pending",
      invitedAt: inviteData.user.invited_at ?? new Date().toISOString(),
      acceptedAt: null,
      expiresAt: inviteData.user.invited_at
        ? new Date(new Date(inviteData.user.invited_at).getTime() + INVITE_TTL_HOURS * 60 * 60 * 1000).toISOString()
        : null,
      clientId,
      clientName: null,
      invitedById: actorId,
      invitedByName: toFullName(inviterProfile?.first_name, inviterProfile?.last_name),
      canResend: true,
      canRevoke: true,
    };

    return jsonResponse(200, { ok: true, invite });
  }

  if (body.action === "revoke") {
    const inviteId = body.inviteId?.trim();
    if (!inviteId) {
      return jsonResponse(400, { ok: false, error: "inviteId is required." });
    }

    const { data: targetData, error: targetError } = await adminClient.auth.admin.getUserById(inviteId);
    const targetUser = targetData?.user ?? null;

    if (targetError || !targetUser) {
      return jsonResponse(404, { ok: false, error: "Invite target was not found." });
    }

    const metadata = (targetUser.user_metadata ?? {}) as InviteMetadata;
    const role = normalizeInviteRole(metadata.invited_role);
    if (!role) {
      return jsonResponse(400, { ok: false, error: "This user is not tracked as an invited account." });
    }

    if (isAccepted(targetUser)) {
      return jsonResponse(400, { ok: false, error: "Accepted invites cannot be revoked from this screen." });
    }

    const { error: deleteError } = await adminClient.auth.admin.deleteUser(inviteId);
    if (deleteError) {
      return jsonResponse(500, { ok: false, error: deleteError.message });
    }

    await adminClient.from("client_users").delete().eq("user_id", inviteId);
    await adminClient.from("users").delete().eq("id", inviteId);

    return jsonResponse(200, { ok: true });
  }

  return jsonResponse(400, { ok: false, error: "Action is invalid." });
});
