# manage-invites

Supabase Edge Function for admin invitation lifecycle operations.

## Purpose

- Provide a secure admin-only API for invite management.
- Support invitation list and lifecycle actions without exposing service-role credentials.
- Return invite statuses derived from Auth metadata and timestamps:
  - pending
  - accepted
  - expired

## Required secrets

Set in the Supabase project for this function:

- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- APP_BASE_URL (recommended)
- INVITE_EXPIRY_HOURS (optional, default 168)

## Request

`POST /functions/v1/manage-invites`

Headers:

- Authorization: Bearer <user_access_token>
- Content-Type: application/json

Body (list):

```json
{
  "action": "list"
}
```

Body (resend):

```json
{
  "action": "resend",
  "inviteId": "<auth_user_id>"
}
```

Body (revoke):

```json
{
  "action": "revoke",
  "inviteId": "<auth_user_id>"
}
```

## Response

Success list:

```json
{
  "ok": true,
  "invites": []
}
```

Success resend:

```json
{
  "ok": true,
  "invite": {
    "id": "<auth_user_id>",
    "status": "pending"
  }
}
```

Success revoke:

```json
{
  "ok": true
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

- Only admin/super_admin actors can call this function.
- Resend and revoke are blocked for accepted invites.
- Resend replaces the old pending/expired invite with a new invite record.
- For client role invites, client mapping is preserved on resend.
