# send-invite

Supabase Edge Function for invite-only onboarding.

## Purpose

- Enforce invite permissions on the server side.
- Use service-role operations without exposing privileged keys to the frontend.
- Support:
  - admin/super_admin invites: `client`, `manager`, `admin`
  - manager invites: `client` only, and only for assigned clients

## Required secrets

Set in the Supabase project for this function:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `APP_BASE_URL` (recommended, used to constrain redirect origin)

## Request

`POST /functions/v1/send-invite`

Headers:

- `Authorization: Bearer <user_access_token>`
- `Content-Type: application/json`

Body:

```json
{
  "email": "user@company.com",
  "role": "client",
  "clientId": "<uuid>",
  "redirectTo": "https://app.example.com/login"
}
```

## Response

Success:

```json
{
  "ok": true,
  "inviteId": "<auth_user_id>"
}
```

Failure:

```json
{
  "ok": false,
  "error": "<message>"
}
```

## Notes

- For `role = client`, `clientId` is required.
- Managers are blocked from inviting `manager/admin` roles.
- Managers are blocked from inviting client users to non-assigned clients.
- Function upserts `users` profile row and client mapping when role is `client`.
